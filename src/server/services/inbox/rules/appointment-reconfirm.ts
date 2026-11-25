import { and, eq, isNull, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { casePhase, caseTitle } from '$server/scheduling/reconfirm';
import { closeStaleCases } from '$server/services/reconfirm.service';
import type { Draft } from '$server/services/inbox/inbox.service';
import type { Rule, RuleResult } from './types';
import { dateKeyWeekday, instantDateKey, instantParts } from '$lib/time/zoned';

const KIND = 'appointment.reconfirm';
const PHASES = ['agent', 'staff', 'done'] as const;
const DONE_TTL_MS = 48 * 60 * 60 * 1000;

export interface ReconfirmCaseRow {
  caseId: string;
  bookingId: string;
  agentState: string;
  result: string | null;
  summary: string | null;
  closedAt: Date | null;
  startTime: Date;
  timezone: string;
  serviceTitle: string;
  attendeeName: string | null;
  /** The confirmation of a move the agent made could not be sent to the client. */
  confirmFailed?: boolean;
}

// shortcut: fixed Spanish like the other rules (a cron tick has no request locale). Built from the
// zoned helpers rather than Intl so no locale-dependent formatter bypass is added (content contract).
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const pad2 = (n: number) => String(n).padStart(2, '0');

function when(start: Date, timezone: string): { text: string; day: string } {
  try {
    const p = instantParts(start, timezone);
    const day = instantDateKey(start, timezone); // YYYY-MM-DD in the org's zone
    const weekday = WEEKDAYS[dateKeyWeekday(day) ?? 0];
    return {
      text: `${weekday} ${p.day} de ${MONTHS[p.month - 1]}, ${pad2(p.hour)}:${pad2(p.minute)}`,
      day,
    };
  } catch {
    return { text: start.toISOString(), day: start.toISOString().slice(0, 10) };
  }
}

/** The notification a case owns right now, or null when it has nothing to show. Pure; exported for the test. */
export function reconfirmDraft(orgId: string, c: ReconfirmCaseRow): Draft | null {
  const phase = casePhase(c);
  if (!phase) return null;
  const w = when(c.startTime, c.timezone);
  const notified = c.result === 'rescheduled' && c.confirmFailed ? false : true;
  const body = [`${c.serviceTitle} · ${c.attendeeName ?? '—'} · ${w.text}`, c.summary]
    .filter(Boolean)
    .join('\n');
  return {
    scope: 'role',
    orgId,
    capability: 'scheduling:manage',
    kind: KIND,
    severity: phase === 'staff' || notified === false ? 'warning' : 'info',
    title: notified === false ? 'Reprogramada, pero no se pudo avisar al cliente' : caseTitle(c),
    body,
    // The calendar lands on the right day; `booking` opens the drawer once spec 139 S3 wires it.
    href: `/scheduling/calendar?date=${w.day}&booking=${c.bookingId}`,
    subjectType: 'sched_booking',
    subjectId: c.bookingId,
    dedupeKey: `reconfirm:${orgId}:${c.caseId}:${phase}`,
    expiresAt: phase === 'done' && c.closedAt ? new Date(c.closedAt.getTime() + DONE_TTL_MS) : null,
  };
}

/**
 * One notification per reconfirmation case, keyed by phase (the inbox service only inserts, never
 * updates, so a case that moves on gets a new row and the old phase is resolved). Closes cases whose
 * appointment is gone or was moved first, so their notifications resolve in the same pass.
 */
export const appointmentReconfirmRule: Rule = {
  key: KIND,
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    await closeStaleCases(ctx, now);

    const found = (await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select c.id, c.booking_id, c.agent_state, c.result, c.summary, c.closed_at,
               b.start_time, r.timezone, et.title as service_title, b.attendee_name,
               exists (select 1 from sched_reconfirm_events e
                 where e.case_id = c.id and e.kind = 'system' and e.step = 'confirm'
                   and e.data->>'error' = 'send') as confirm_failed
        from sched_reconfirm_cases c
        join sched_bookings b on b.id = c.booking_id and b.org_id = c.org_id
        join sched_resources r on r.id = b.resource_id and r.org_id = b.org_id
        join sched_event_types et on et.id = b.event_type_id and et.org_id = b.org_id
        where c.org_id = ${ctx.tenantId}
          and (c.closed_at is null
               or (c.close_action = 'agent' and c.closed_at > ${new Date(now.getTime() - DONE_TTL_MS).toISOString()}::timestamptz))
      `),
    )) as unknown as Array<Record<string, unknown>>;

    const upserts = found
      .map((r) =>
        reconfirmDraft(ctx.tenantId, {
          caseId: String(r.id),
          bookingId: String(r.booking_id),
          agentState: String(r.agent_state),
          result: r.result == null ? null : String(r.result),
          summary: r.summary == null ? null : String(r.summary),
          closedAt: r.closed_at ? new Date(String(r.closed_at)) : null,
          startTime: new Date(String(r.start_time)),
          timezone: String(r.timezone),
          serviceTitle: String(r.service_title),
          attendeeName: r.attendee_name == null ? null : String(r.attendee_name),
          confirmFailed: r.confirm_failed === true,
        }),
      )
      .filter((d): d is Draft => d !== null);

    // Resolve every unresolved row that is not some case's CURRENT phase: other phases of a case that
    // moved on, and all rows of a case that staff closed or whose booking is no longer live.
    const current = new Set(upserts.map((d) => d.dedupeKey));
    const existing = await withOrgCore(ctx, (tx) =>
      tx
        .select({ dedupeKey: appNotifications.dedupeKey })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, KIND),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        ),
    );
    const resolve = existing
      .map((r) => r.dedupeKey)
      .filter(
        (k): k is string =>
          Boolean(k) && !current.has(k) && PHASES.some((p) => k!.endsWith(`:${p}`)),
      );
    return { upserts, resolve };
  },
};
