import { sql, type SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { assertInterval, ControlAccumulator, intervalContained } from './audit.logic';
import {
  AuditAdmissionError,
  AuditIncompleteError,
  type AuditControlName,
  type AuditInterval,
  type AuditScope,
  type AuditSink,
  type AuditSubject,
  type AuditSummary,
} from './audit.types';
import { clientKeySql, LIST_PENDING_LINE_WHERE } from './list';
import { UNBILLED_BOOKING_WHERE } from './unbilled';

const PAGE = 1000;
const SUBJECT_CAP = 1_000_000;

/** `col` within [after, before) as local midnights in the verified accounting timezone (database conversion). */
function within(col: string, interval: AuditInterval, tz: string): SQL {
  const parts: SQL[] = [sql`true`];
  if (interval.after)
    parts.push(
      sql`${sql.raw(col)} >= (${interval.after}::date::timestamp at time zone ${tz}::text)`,
    );
  if (interval.before)
    parts.push(
      sql`${sql.raw(col)} < (${interval.before}::date::timestamp at time zone ${tz}::text)`,
    );
  return sql.join(parts, sql` and `);
}

interface SubjectRow extends Record<string, unknown> {
  id: string;
  status: string;
  occurred_at: Date | string;
  has_identity: boolean;
  client_key: string | null;
  in_cohort: boolean;
  unbilled?: boolean;
  badge?: boolean;
  list?: boolean;
}

/**
 * Complete same-snapshot inventory of the audit universe U and the canonical controls over it.
 * The caller owns the READ ONLY REPEATABLE READ transaction, GUC scope and authority admission; this
 * function issues only SELECTs on the passed CoreTx (no wrapper, no pool, no advisory lock).
 */
export async function runAuditInventory(
  tx: CoreTx,
  scope: AuditScope,
  sink: AuditSink,
): Promise<AuditSummary> {
  const { orgId, accountingTimezone: tz, approved } = scope;
  const cohort: AuditInterval = {
    after: scope.cohort.after ?? approved.after,
    before: scope.cohort.before ?? approved.before,
  };
  try {
    assertInterval(approved, 'approved scope');
    assertInterval(cohort, 'cohort');
  } catch (error) {
    throw new AuditAdmissionError(error instanceof Error ? error.message : 'invalid_interval');
  }
  if (!intervalContained(cohort, approved))
    throw new AuditAdmissionError('cohort_outside_approved_scope');

  const [policy] = await tx.execute<{ timezone: string | null }>(
    sql`select timezone from public.fin_settings where org_id = ${orgId}`,
  );
  // No fallback zone: a default nobody reviewed must not choose cohort boundaries.
  if (!policy?.timezone || policy.timezone !== tz)
    throw new AuditAdmissionError('accounting_timezone_mismatch');

  const finite = approved.after !== null || approved.before !== null;
  if (finite) {
    const [corrupt] = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from public.pos_ticket_lines tl
      join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
      where tl.org_id = ${orgId} and tl.kind = 'service' and tl.booking_id is null and tl.plan_id is null
        and t.submitted_at is null`);
    if (Number(corrupt?.n ?? 0) > 0) throw new AuditIncompleteError('scope_timestamp_corrupt');
  }

  const acc: Record<AuditControlName, ControlAccumulator> = {
    badgePaidLines: new ControlAccumulator(),
    unbilledBookings: new ControlAccumulator(),
    listPendingLines: new ControlAccumulator(),
  };
  const residualCounts = { badge_not_list: 0, list_not_badge: 0 };
  let subjectCount = 0;
  let cohortSubjectCount = 0;

  const emit = async (subject: AuditSubject) => {
    subjectCount += 1;
    if (subjectCount > SUBJECT_CAP) throw new AuditIncompleteError('subject_limit');
    if (subject.inCohort) {
      cohortSubjectCount += 1;
      await sink.writeSubject(subject);
    }
  };
  const iso = (value: Date | string) => new Date(value).toISOString();

  // Bookings: every same-org booking started inside U (any status, funding or link state).
  for (let last = '00000000-0000-0000-0000-000000000000'; ;) {
    const rows = await tx.execute<SubjectRow>(sql`
      select b.id::text as id, b.status, b.start_time as occurred_at,
             (b.party_id is not null or b.crm_contact_id is not null) as has_identity,
             case when b.party_id is not null or b.crm_contact_id is not null then ${clientKeySql('b')} end as client_key,
             (${UNBILLED_BOOKING_WHERE}) as unbilled,
             (${within('b.start_time', cohort, tz)}) as in_cohort
      from public.sched_bookings b
      left join public.crm_contacts c on c.id = b.crm_contact_id and c.org_id = b.org_id
      where b.org_id = ${orgId} and b.id > ${last}::uuid and ${within('b.start_time', approved, tz)}
      order by b.id limit ${PAGE}`);
    for (const row of rows) {
      const counted = row.unbilled === true && row.has_identity;
      if (counted) acc.unbilledBookings.add(row.id, row.in_cohort);
      await emit({
        schemaVersion: 1,
        kind: 'booking',
        id: row.id,
        clientKey: row.client_key,
        status: row.status,
        occurredAt: iso(row.occurred_at),
        inCohort: row.in_cohort,
        counted: { badge: counted, list: counted },
      });
    }
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].id;
  }

  // Paid unscheduled service lines, on ANY ticket status (void and legacy voided are inactive subjects).
  for (let last = '00000000-0000-0000-0000-000000000000'; ;) {
    const rows = await tx.execute<SubjectRow>(sql`
      select tl.id::text as id, t.status, t.submitted_at as occurred_at,
             (t.party_id is not null or t.crm_contact_id is not null) as has_identity,
             case when t.party_id is not null or t.crm_contact_id is not null then ${clientKeySql('t')} end as client_key,
             (t.status not in ('void', 'voided')) as badge,
             (${LIST_PENDING_LINE_WHERE}) as list,
             (${within('t.submitted_at', cohort, tz)}) as in_cohort
      from public.pos_ticket_lines tl
      join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
      left join public.crm_contacts c on c.id = t.crm_contact_id and c.org_id = t.org_id
      where tl.org_id = ${orgId} and tl.kind = 'service' and tl.booking_id is null and tl.plan_id is null
        and tl.id > ${last}::uuid and ${within('t.submitted_at', approved, tz)}
      order by tl.id limit ${PAGE}`);
    for (const row of rows) {
      const badge = row.badge === true;
      const list = row.list === true;
      if (badge) acc.badgePaidLines.add(row.id, row.in_cohort);
      if (list) acc.listPendingLines.add(row.id, row.in_cohort);
      // The two readers intentionally differ; never change either to force equality.
      if (badge !== list) {
        const control = badge ? 'badge_not_list' : 'list_not_badge';
        residualCounts[control] += 1;
        await sink.writeResidual({
          schemaVersion: 1,
          control,
          subjectKind: 'paid_unscheduled_line',
          id: row.id,
          inCohort: row.in_cohort,
          reasonCode: badge ? 'identity_required' : 'legacy_voided',
        });
      }
      await emit({
        schemaVersion: 1,
        kind: 'paid_unscheduled_line',
        id: row.id,
        clientKey: row.client_key,
        status: row.status,
        occurredAt: iso(row.occurred_at),
        inCohort: row.in_cohort,
        counted: { badge, list },
      });
    }
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].id;
  }

  const controls = {
    badgePaidLines: acc.badgePaidLines.finish(),
    unbilledBookings: acc.unbilledBookings.finish(),
    listPendingLines: acc.listPendingLines.finish(),
  };
  return {
    schemaVersion: 1,
    orgId,
    coverage: finite ? 'approved_scope' : 'organization_all_date',
    accountingTimezone: tz,
    approved,
    cohort,
    subjectCount,
    cohortSubjectCount,
    controls,
    totals: {
      badge: controls.badgePaidLines.count + controls.unbilledBookings.count,
      list: controls.listPendingLines.count + controls.unbilledBookings.count,
    },
    residualCounts,
  };
}
