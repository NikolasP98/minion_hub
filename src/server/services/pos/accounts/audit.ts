import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import {
  assertInterval,
  canonicalIntentValue,
  ControlAccumulator,
  intervalContained,
} from './audit.logic';
import {
  AuditAdmissionError,
  AuditIncompleteError,
  type AuditControlName,
  type AuditInvoiceRef,
  type BookingInvoiceLink,
  type LinkIntent,
  type TicketInvoiceLink,
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

/**
 * Same-snapshot invoice linkage for the given bookings and tickets (contracts/invoice-linkage.md). Every
 * lookup equates the organization; provider_ref is matched byte-for-byte (no trim or case folding); an
 * explicit link whose target is missing is `invoice_link_unresolved`, never "unlinked". Caller bounds the id lists.
 */
export async function loadAuditInvoiceLinks(
  tx: CoreTx,
  orgId: string,
  bookingIds: readonly string[],
  ticketIds: readonly string[],
): Promise<{ bookings: BookingInvoiceLink[]; tickets: TicketInvoiceLink[] }> {
  const bookingList = [...new Set(bookingIds)].sort();
  const bookings: BookingInvoiceLink[] = [];
  const ticketSet = new Set(ticketIds);
  const perBooking = new Map<string, { lines: string[]; tickets: string[] }>();
  if (bookingList.length) {
    const rows = await tx.execute<{ booking_id: string; line_id: string; ticket_id: string }>(sql`
      select tl.booking_id::text as booking_id, tl.id::text as line_id, t.id::text as ticket_id
      from public.pos_ticket_lines tl
      join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
      where tl.org_id = ${orgId} and tl.booking_id = any(${sql.raw(`array[${bookingList.map((id) => `'${assertUuid(id)}'`).join(',')}]::uuid[]`)})
      order by tl.id`);
    for (const row of rows) {
      const entry = perBooking.get(row.booking_id) ?? { lines: [], tickets: [] };
      entry.lines.push(row.line_id);
      entry.tickets.push(row.ticket_id);
      ticketSet.add(row.ticket_id);
      perBooking.set(row.booking_id, entry);
    }
  }
  const explicit = new Map<string, string | null>();
  if (bookingList.length) {
    const rows = await tx.execute<{ id: string; invoice_id: string | null }>(sql`
      select id::text as id, invoice_id::text as invoice_id from public.sched_bookings
      where org_id = ${orgId} and id = any(${sql.raw(`array[${bookingList.map((id) => `'${assertUuid(id)}'`).join(',')}]::uuid[]`)})`);
    for (const row of rows) explicit.set(row.id, row.invoice_id);
  }
  const explicitIds = [
    ...new Set([...explicit.values()].filter((v): v is string => v !== null)),
  ].sort();
  const explicitFound = new Set<string>();
  if (explicitIds.length) {
    const rows = await tx.execute<{ id: string }>(sql`
      select id::text as id from public.fin_invoices
      where org_id = ${orgId} and id = any(${sql.raw(`array[${explicitIds.map((id) => `'${assertUuid(id)}'`).join(',')}]::uuid[]`)})`);
    for (const row of rows) explicitFound.add(row.id);
  }
  const ticketList = [...ticketSet].sort();
  const refs = new Map<string, string | null>();
  if (ticketList.length) {
    const rows = await tx.execute<{ id: string; ref: string | null }>(sql`
      select id::text as id, nullif(invoice_provider_ref, '') as ref from public.pos_tickets
      where org_id = ${orgId} and id = any(${sql.raw(`array[${ticketList.map((id) => `'${assertUuid(id)}'`).join(',')}]::uuid[]`)})`);
    for (const row of rows) refs.set(row.id, row.ref);
  }
  const distinctRefs = [
    ...new Set([...refs.values()].filter((v): v is string => v !== null)),
  ].sort();
  const matchesByRef = new Map<string, AuditInvoiceRef[]>();
  for (const ref of distinctRefs) {
    const rows = await tx.execute<{
      id: string;
      provider: string;
      provider_ref: string;
      status: string | null;
      shadowed: boolean;
    }>(sql`
      select id::text as id, provider, provider_ref, status, shadowed from public.fin_invoices
      where org_id = ${orgId} and provider_ref = ${ref}
      order by provider collate "C", id`);
    matchesByRef.set(
      ref,
      rows.map((r) => ({
        invoiceId: r.id,
        provider: r.provider,
        providerRef: r.provider_ref,
        status: r.status,
        shadowed: r.shadowed,
      })),
    );
  }
  const tickets: TicketInvoiceLink[] = ticketList.map((ticketId) => {
    const providerRef = refs.get(ticketId) ?? null;
    const matches = providerRef ? (matchesByRef.get(providerRef) ?? []) : [];
    const live = matches.filter((m) => !m.shadowed);
    const state =
      providerRef === null
        ? 'none'
        : matches.length === 0
          ? 'unresolved'
          : live.length === 1 && matches.length === 1
            ? 'one_nonshadowed'
            : 'ambiguous';
    return { ticketId, providerRef, matches, state };
  });
  const byTicket = new Map(tickets.map((t) => [t.ticketId, t]));
  for (const bookingId of bookingList) {
    const direct = perBooking.get(bookingId);
    const explicitInvoiceId = explicit.get(bookingId) ?? null;
    bookings.push({
      bookingId,
      explicitInvoiceId,
      explicitResolved: explicitInvoiceId === null || explicitFound.has(explicitInvoiceId),
      ticketLineIds: direct?.lines ?? [],
      providerMatches: [...new Set(direct?.tickets ?? [])].flatMap((ticketId) => {
        const t = byTicket.get(ticketId);
        return t?.providerRef ? [{ ticketId, providerRef: t.providerRef, matches: t.matches }] : [];
      }),
    });
  }
  return { bookings, tickets };
}

function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new Error('invalid uuid in audit id list');
  return id;
}

/**
 * True when invoice facts forbid a paid-line->booking proposal: any explicit invoice link, any nonempty ticket
 * provider reference, an ambiguous match, or an unresolved target. Facts are evidence, never settlement proof.
 */
export function invoiceLinkBlocksProposal(
  link: BookingInvoiceLink,
  ticket?: TicketInvoiceLink,
): boolean {
  return (
    link.explicitInvoiceId !== null ||
    !link.explicitResolved ||
    link.providerMatches.length > 0 ||
    (ticket !== undefined && ticket.state !== 'none')
  );
}

const sha256 = (value: unknown) =>
  createHash('sha256').update(canonicalIntentValue(value), 'utf8').digest('hex');
/** Decimal text ("10.00", "1.5") to integer minor-unit string with two places; refuses sub-minor precision. */
export function toMinorString(value: string | number): string {
  const text = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error('invalid money value');
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > 2) throw new Error('sub-minor money value');
  const minor = BigInt(m[2]) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  return `${m[1] && minor !== 0n ? '-' : ''}${minor}`;
}

interface PairRow extends Record<string, unknown> {
  line_id: string;
  ticket_id: string;
  line_booking: string | null;
  product: string | null;
  qty: string;
  line_total: string;
  plan: string | null;
  redemption: string | null;
  status: string;
  submitted_at: Date | string;
  currency: string;
  ticket_total: string;
  provider_ref: string | null;
  client_key: string | null;
  b_id: string;
  b_updated: Date | string;
  b_status: string;
  b_product: string | null;
  b_start: Date | string;
  b_invoice: string | null;
  b_grant: string | null;
  b_plan: string | null;
  b_unbilled: boolean;
}

/**
 * Immutable line->existing-booking LinkIntent for one exact pair, from same-snapshot rows only. It never
 * calls bookAndLinkTicketLine and writes nothing. Wallet and account display are a PURE counterfactual:
 * only the line's bookingId changes, so wallet is unchanged and the pending counts move by the pair's own contribution.
 * TODO(handoff): sourceFingerprint omits the FinancialSourceRows/stock facets and logicalRowPresent ignores
 * plan/grant/ledger facets (T017 closure loader is not built); proposals are therefore not yet eligible output.
 */
export async function buildLinkIntent(
  tx: CoreTx,
  input: {
    orgId: string;
    sourceGitSha: string;
    ticketLineId: string;
    bookingMemberId: string;
    evidence: { assertionIds: string[]; documentHashes: string[]; assertionsHash: string };
  },
): Promise<LinkIntent> {
  const { orgId } = input;
  const [row] = await tx.execute<PairRow>(sql`
    select tl.id::text as line_id, tl.ticket_id::text, tl.booking_id::text as line_booking, tl.fin_product_id::text as product,
           tl.qty::text, tl.total::text as line_total, tl.plan_id::text as plan, tl.redemption_id::text as redemption,
           t.status, t.submitted_at, t.currency, t.total::text as ticket_total, nullif(t.invoice_provider_ref,'') as provider_ref,
           case when t.party_id is not null or t.crm_contact_id is not null then ${clientKeySql('t')} end as client_key,
           b.id::text as b_id, b.updated_at as b_updated, b.status as b_status, b.product_id::text as b_product, b.start_time as b_start,
           b.invoice_id::text as b_invoice, b.package_grant_id::text as b_grant, b.payment_plan_id::text as b_plan,
           (${UNBILLED_BOOKING_WHERE}) as b_unbilled
    from public.pos_ticket_lines tl
    join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
    left join public.crm_contacts c on c.id = t.crm_contact_id and c.org_id = t.org_id
    join public.sched_bookings b on b.id = ${input.bookingMemberId}::uuid and b.org_id = tl.org_id
    where tl.org_id = ${orgId} and tl.id = ${input.ticketLineId}::uuid`);
  if (!row || row.line_booking !== null || row.plan !== null || !row.client_key)
    throw new AuditIncompleteError('pair_not_eligible');
  const [counts] = await tx.execute<{ pending: string; unbilled: string }>(sql`
    select
      (select count(*) from public.pos_ticket_lines tl join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
         left join public.crm_contacts c on c.id = t.crm_contact_id and c.org_id = t.org_id
        where tl.org_id = ${orgId} and ${LIST_PENDING_LINE_WHERE} and ${clientKeySql('t')} = ${row.client_key})::text as pending,
      (select count(*) from public.sched_bookings b left join public.crm_contacts c on c.id = b.crm_contact_id and c.org_id = b.org_id
        where b.org_id = ${orgId} and (b.party_id is not null or b.crm_contact_id is not null) and ${UNBILLED_BOOKING_WHERE}
          and ${clientKeySql('b')} = ${row.client_key})::text as unbilled`);
  const wallet = await tx.execute<{ currency: string; total: string }>(sql`
    select l.currency, sum(l.amount)::text as total from public.pos_client_ledger l
      left join public.crm_contacts c on c.id = l.crm_contact_id and c.org_id = l.org_id
     where l.org_id = ${orgId} and ${clientKeySql('l')} = ${row.client_key}
     group by l.currency order by l.currency collate "C"`);
  const balances = wallet.map((w) => ({
    currency: w.currency,
    balanceMinor: toMinorString(w.total),
  }));
  const posCurrency = row.currency;
  const displayBalance = balances.find((b) => b.currency === posCurrency)?.balanceMinor ?? '0';
  const unbilledDelta: -1 | 0 = row.b_unbilled ? -1 : 0;
  const pending = Number(counts.pending);
  const unbilled = Number(counts.unbilled);
  const before = {
    pendingScheduling: pending,
    pendingInvoice: unbilled,
    logicalRowPresent: pending + unbilled > 0 || balances.some((b) => b.balanceMinor !== '0'),
    posCurrency,
    displayBalanceMinor: displayBalance,
  };
  const after = {
    ...before,
    pendingScheduling: pending - 1,
    pendingInvoice: unbilled + unbilledDelta,
  };
  after.logicalRowPresent =
    after.pendingScheduling + after.pendingInvoice > 0 ||
    balances.some((b) => b.balanceMinor !== '0');
  const iso = (v: Date | string) => new Date(v).toISOString();
  const ticket = {
    id: row.ticket_id,
    status: row.status,
    submittedAt: iso(row.submitted_at),
    currency: row.currency,
    total: toMinorString(row.ticket_total),
    invoiceProviderRef: row.provider_ref,
  };
  const line = {
    id: row.line_id,
    ticketId: row.ticket_id,
    bookingId: null,
    productId: row.product,
    quantity: String(row.qty),
    total: toMinorString(row.line_total),
    planId: null,
    redemptionId: row.redemption,
  };
  const booking = {
    id: row.b_id,
    updatedAt: iso(row.b_updated),
    status: row.b_status,
    productId: row.b_product,
    startTime: iso(row.b_start),
    invoiceId: row.b_invoice,
    grantId: row.b_grant,
    planId: row.b_plan,
  };
  return {
    schemaVersion: 1,
    orgId,
    sourceGitSha: input.sourceGitSha,
    pair: { ticketLineId: input.ticketLineId, bookingMemberId: input.bookingMemberId },
    before: {
      ticket,
      line,
      booking,
      identityKey: row.client_key,
      sourceFingerprint: sha256({ ticket, line, booking, balances, pending, unbilled }),
    },
    evidence: input.evidence,
    change: { field: 'pos_ticket_lines.booking_id', from: null, to: input.bookingMemberId },
    effects: {
      paidUnscheduledDelta: -1,
      unbilledBookingDelta: unbilledDelta,
      paymentMinorDelta: '0',
      stockQuantityDelta: '0',
      lifecycleChanges: [],
      wallet: { before: balances, after: balances, ledgerRowsDelta: 0 },
      accountDisplay: {
        before,
        after,
        visibleCappedRow: null,
        visibilityReason: 'not_predicted_limit_or_sort',
      },
    },
    accountControlSha256: sha256({ before, after, balances }),
    blockers: [],
  };
}
