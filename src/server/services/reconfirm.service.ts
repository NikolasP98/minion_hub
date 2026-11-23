/**
 * Spec 139: reconfirmation cases. A client's "no" to a reminder opens ONE case per appointment
 * (per visit for a merged visit) and the appointment keeps its status. This module records and
 * closes cases and logs verdicts. It must never import a cancel, release or redemption function:
 * the agent has no way to cancel, refund or hand back a session (checked by reconfirm.service.test.ts).
 *
 * Never log message text or phone numbers; ids and error names only.
 */
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Classified, ReplyVerdict } from './reminder-compose';
import { caseTitle } from '$server/scheduling/reconfirm';

export type CloseAction = 'attended' | 'agent' | 'booking_closed' | 'moved_by_staff';

const MAX_EVENT_TEXT = 2000;
const rows = (r: unknown) => r as unknown as Array<Record<string, unknown>>;
const iso = (d: Date) => d.toISOString();
const clip = (texts: string[]) => texts.join('\n').slice(0, MAX_EVENT_TEXT);

function verdictEvent(
  ctx: CoreCtx,
  bookingId: string,
  caseId: string | null,
  verdict: Classified<string>,
  texts: string[],
  inboundAt: Date,
) {
  return sql`
    insert into sched_reconfirm_events
      (org_id, booking_id, case_id, kind, verdict, confidence, via, content, inbound_at, data)
    values (${ctx.tenantId}, ${bookingId}::uuid, ${caseId}::uuid, 'verdict', ${verdict.verdict},
      ${verdict.confidence}, ${verdict.via}, ${clip(texts)}, ${iso(inboundAt)}::timestamptz,
      ${JSON.stringify({ probabilities: verdict.probabilities ?? null, cost: verdict.cost ?? null })}::jsonb)
  `;
}

/**
 * Open a case for a negation. Writes the case and the verdict event, nothing else: no cancel,
 * no release, no message. A second negation for the same subject (unique open-case index) adds
 * only an event and reports `created: false`.
 */
export async function openCase(
  ctx: CoreCtx,
  input: {
    bookingId: string;
    subjectKey: string;
    contactId: string | null;
    channel: string;
    accountId: string | null;
    recipient: string;
    bookingStartAt: Date;
    result?: 'unclear' | 'late_reply' | null;
    verdict: Classified<ReplyVerdict>;
    texts: string[];
    inboundAt: Date;
  },
): Promise<{ caseId: string; created: boolean }> {
  return withOrgCore(ctx, async (tx) => {
    const inserted = rows(
      await tx.execute(sql`
        insert into sched_reconfirm_cases
          (org_id, booking_id, subject_key, contact_id, channel, account_id, recipient,
           booking_start_at, result, last_inbound_at)
        values (${ctx.tenantId}, ${input.bookingId}::uuid, ${input.subjectKey}, ${input.contactId}::uuid,
          ${input.channel}, ${input.accountId}, ${input.recipient}, ${iso(input.bookingStartAt)}::timestamptz,
          ${input.result ?? null}, ${iso(input.inboundAt)}::timestamptz)
        on conflict (org_id, subject_key) where closed_at is null do nothing
        returning id
      `),
    );
    let caseId = inserted[0]?.id ? String(inserted[0].id) : null;
    const created = caseId !== null;
    if (!caseId) {
      // TODO(handoff): a confident negation landing on an open case whose result is `unclear` keeps that
      // result; staff still see the logged verdict events. Clear the result here once the drawer (S3) shows events.
      const open = rows(
        await tx.execute(sql`
          update sched_reconfirm_cases set last_inbound_at = ${iso(input.inboundAt)}::timestamptz
          where org_id = ${ctx.tenantId} and subject_key = ${input.subjectKey} and closed_at is null
          returning id
        `),
      );
      if (!open[0]) throw new Error('reconfirm: open case vanished during insert'); // closed between the two statements; the next scan opens a fresh one
      caseId = String(open[0].id);
    }
    await tx.execute(
      verdictEvent(ctx, input.bookingId, caseId, input.verdict, input.texts, input.inboundAt),
    );
    return { caseId, created };
  });
}

/** Log a verdict that opened no case (yes, unclear, below the confidence floor). */
export async function logVerdict(
  ctx: CoreCtx,
  input: {
    bookingId: string;
    caseId?: string | null;
    verdict: Classified<string>;
    texts: string[];
    inboundAt: Date;
  },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.execute(
      verdictEvent(
        ctx,
        input.bookingId,
        input.caseId ?? null,
        input.verdict,
        input.texts,
        input.inboundAt,
      ),
    ),
  );
}

/** The scan's cursor: newest client message already classified, per booking. */
export async function lastInboundAt(
  ctx: CoreCtx,
  bookingIds: string[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!bookingIds.length) return out;
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select booking_id, max(inbound_at) as last_at
        from sched_reconfirm_events
        where org_id = ${ctx.tenantId} and kind = 'verdict' and inbound_at is not null
          and booking_id in (${sql.join(
            bookingIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
        group by booking_id
      `),
    ),
  );
  for (const r of found) if (r.last_at) out.set(String(r.booking_id), new Date(String(r.last_at)));
  return out;
}

export interface ReconfirmCaseView {
  id: string;
  open: boolean;
  agentState: string;
  result: string | null;
  title: string;
  summary: string | null;
  openedAt: Date;
  waitUntil: Date | null;
  contactId: string | null;
  recipient: string;
  events: Array<{
    kind: string;
    verdict: string | null;
    confidence: number | null;
    content: string | null;
    step: string | null;
    createdAt: Date;
  }>;
}

/** The booking's latest case, an open one first, with its events. */
export async function getCaseForBooking(
  ctx: CoreCtx,
  bookingId: string,
): Promise<ReconfirmCaseView | null> {
  return withOrgCore(ctx, async (tx) => {
    const found = rows(
      await tx.execute(sql`
        select * from sched_reconfirm_cases
        where org_id = ${ctx.tenantId} and booking_id = ${bookingId}::uuid
        order by (closed_at is null) desc, opened_at desc
        limit 1
      `),
    );
    const c = found[0];
    if (!c) return null;
    const events = rows(
      await tx.execute(sql`
        select kind, verdict, confidence, content, step, created_at from sched_reconfirm_events
        where org_id = ${ctx.tenantId} and case_id = ${String(c.id)}::uuid
        order by created_at asc
      `),
    );
    const agentState = String(c.agent_state);
    const result = c.result == null ? null : String(c.result);
    return {
      id: String(c.id),
      open: c.closed_at == null,
      agentState,
      result,
      title: caseTitle({ agentState, result }),
      summary: c.summary == null ? null : String(c.summary),
      openedAt: new Date(String(c.opened_at)),
      waitUntil: c.wait_until ? new Date(String(c.wait_until)) : null,
      contactId: c.contact_id == null ? null : String(c.contact_id),
      // TODO(handoff): mask `recipient` and event `content` for a viewer without attendee PII
      // access (as `getBookingDetail` does with `maskAttendeePii`) before S3 exposes this in the drawer.
      recipient: String(c.recipient),
      events: events.map((e) => ({
        kind: String(e.kind),
        verdict: e.verdict == null ? null : String(e.verdict),
        confidence: e.confidence == null ? null : Number(e.confidence),
        content: e.content == null ? null : String(e.content),
        step: e.step == null ? null : String(e.step),
        createdAt: new Date(String(e.created_at)),
      })),
    };
  });
}

/** Which of these bookings have an open case (the "Por reconfirmar" badge). */
export async function openCaseBookingIds(ctx: CoreCtx, bookingIds: string[]): Promise<Set<string>> {
  if (!bookingIds.length) return new Set();
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select distinct booking_id from sched_reconfirm_cases
        where org_id = ${ctx.tenantId} and closed_at is null
          and booking_id in (${sql.join(
            bookingIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
      `),
    ),
  );
  return new Set(found.map((r) => String(r.booking_id)));
}

/** Close a case. Idempotent; never touches the booking. */
export async function closeCase(
  ctx: CoreCtx,
  caseId: string,
  by: { profileId: string | null; action: CloseAction; note?: string | null },
): Promise<'closed' | 'already_closed' | 'not_found'> {
  return withOrgCore(ctx, async (tx) => {
    const closed = rows(
      await tx.execute(sql`
        update sched_reconfirm_cases
        set closed_at = now(), closed_by = ${by.profileId}::uuid, close_action = ${by.action},
            close_note = ${by.note ? by.note.slice(0, 500) : null}
        where id = ${caseId}::uuid and org_id = ${ctx.tenantId} and closed_at is null
        returning id, booking_id
      `),
    );
    if (closed[0]) {
      await tx.execute(sql`
        insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, data)
        values (${ctx.tenantId}, ${String(closed[0].booking_id)}::uuid, ${caseId}::uuid,
          ${by.profileId ? 'staff_action' : 'system'}, ${JSON.stringify({ action: by.action })}::jsonb)
      `);
      return 'closed' as const;
    }
    const exists = rows(
      await tx.execute(
        sql`select 1 from sched_reconfirm_cases where id = ${caseId}::uuid and org_id = ${ctx.tenantId}`,
      ),
    );
    return exists[0] ? ('already_closed' as const) : ('not_found' as const);
  });
}

/**
 * Close open cases that no longer describe a live appointment: the booking is not pending or
 * accepted any more (`booking_closed`), or its start changed since the case opened, which means
 * someone moved it (`moved_by_staff`). Returns how many were closed.
 */
export async function closeStaleCases(ctx: CoreCtx, now: Date): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const closed = rows(
      await tx.execute(sql`
        update sched_reconfirm_cases c
        set closed_at = ${iso(now)}::timestamptz,
            close_action = case when b.status in ('pending','accepted') then 'moved_by_staff' else 'booking_closed' end
        from sched_bookings b
        where c.org_id = ${ctx.tenantId} and c.closed_at is null
          and b.id = c.booking_id and b.org_id = c.org_id
          and (b.status not in ('pending','accepted') or b.start_time <> c.booking_start_at)
        returning c.id
      `),
    );
    return closed.length;
  });
}

export interface AgedUnclear {
  bookingId: string;
  verdict: Classified<ReplyVerdict>;
  texts: string[];
  inboundAt: Date;
}

/**
 * Bookings whose newest logged verdict was unclear (or below the confidence floor), is older than
 * `before`, and that never had a case: the client said something staff should read, and nobody
 * clarified it within the wait time. The caller opens a case with result `unclear` for each.
 */
export async function agedUnclearVerdicts(
  ctx: CoreCtx,
  bookingIds: string[],
  before: Date,
  confidenceMin: number,
): Promise<AgedUnclear[]> {
  if (!bookingIds.length) return [];
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select * from (
          select distinct on (e.booking_id) e.booking_id, e.verdict, e.confidence, e.via, e.content, e.inbound_at
          from sched_reconfirm_events e
          where e.org_id = ${ctx.tenantId} and e.kind = 'verdict' and e.inbound_at is not null
            and e.booking_id in (${sql.join(
              bookingIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
          order by e.booking_id, e.inbound_at desc, e.created_at desc
        ) latest
        where (latest.verdict = 'unclear' or latest.confidence < ${confidenceMin})
          and latest.inbound_at < ${iso(before)}::timestamptz
          and not exists (
            select 1 from sched_reconfirm_cases c
            where c.org_id = ${ctx.tenantId} and c.booking_id = latest.booking_id
          )
      `),
    ),
  );
  return found.map((r) => ({
    bookingId: String(r.booking_id),
    verdict: {
      verdict: 'unclear' as const,
      confidence: Number(r.confidence ?? 0),
      via: r.via === 'keyword' ? ('keyword' as const) : ('jev' as const),
    },
    texts: String(r.content ?? '')
      .split('\n')
      .filter(Boolean),
    inboundAt: new Date(String(r.inbound_at)),
  }));
}
