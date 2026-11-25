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
import { gatewayCall } from '$lib/server/gateway-rpc';
import { reconfirmAskTemplate } from './reminder-compose';
import type { Classified, ReplyVerdict } from './reminder-compose';
import { getReminderConfig } from './reminder-config.service';
import { insertMessages } from './messages.service';
import { maskPii } from '$lib/pii';
import { caseTitle, waitUntil, whenText, LATE_MS } from '$server/scheduling/reconfirm';
import type { CaseResult } from '$server/scheduling/reconfirm';

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
  inboundMessageId: string | null,
) {
  return sql`
    insert into sched_reconfirm_events
      (org_id, booking_id, case_id, kind, verdict, confidence, via, content, inbound_at, inbound_message_id, data)
    values (${ctx.tenantId}, ${bookingId}::uuid, ${caseId}::uuid, 'verdict', ${verdict.verdict},
      ${verdict.confidence}, ${verdict.via}, ${clip(texts)}, ${iso(inboundAt)}::timestamptz,
      ${inboundMessageId}::uuid,
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
    result?: 'unclear' | 'late_reply' | null;
    verdict: Classified<ReplyVerdict>;
    texts: string[];
    inboundAt: Date;
    inboundMessageId?: string | null;
  },
): Promise<{ caseId: string; created: boolean }> {
  return withOrgCore(ctx, async (tx) => {
    const inserted = rows(
      await tx.execute(sql`
        insert into sched_reconfirm_cases
          (org_id, booking_id, subject_key, contact_id, channel, account_id, recipient,
           booking_start_at, result, last_inbound_at)
        values (${ctx.tenantId}, ${input.bookingId}::uuid, ${input.subjectKey}, ${input.contactId}::uuid,
          ${input.channel}, ${input.accountId}, ${input.recipient},
          (select start_time from sched_bookings where id = ${input.bookingId}::uuid and org_id = ${ctx.tenantId}),
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
      // Never bump last_inbound_at here: it is the answer reader's position (S4), and this scan
      // would swallow the client's reply to the agent's question before it is read.
      const open = rows(
        await tx.execute(sql`
          select id from sched_reconfirm_cases
          where org_id = ${ctx.tenantId} and subject_key = ${input.subjectKey} and closed_at is null
        `),
      );
      if (!open[0]) throw new Error('reconfirm: open case vanished during insert'); // closed between the two statements; the next scan opens a fresh one
      caseId = String(open[0].id);
    }
    await tx.execute(
      verdictEvent(
        ctx,
        input.bookingId,
        caseId,
        input.verdict,
        input.texts,
        input.inboundAt,
        input.inboundMessageId ?? null,
      ),
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
    inboundMessageId?: string | null;
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
        input.inboundMessageId ?? null,
      ),
    ),
  );
}

/** The scan's cursor: newest client message already classified, per booking. (at, id) orders ties. */
export async function lastInboundAt(
  ctx: CoreCtx,
  bookingIds: string[],
): Promise<Map<string, { at: Date; id: string | null; closedAt: Date | null }>> {
  const out = new Map<string, { at: Date; id: string | null; closedAt: Date | null }>();
  if (!bookingIds.length) return out;
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select distinct on (booking_id) booking_id, inbound_at as last_at, inbound_message_id as last_id,
          (select max(c.closed_at) from sched_reconfirm_cases c
            where c.org_id = e.org_id and c.booking_id = e.booking_id) as closed_at
        from sched_reconfirm_events e
        where org_id = ${ctx.tenantId} and kind = 'verdict' and inbound_at is not null
          and booking_id in (${sql.join(
            bookingIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
        order by booking_id, inbound_at desc, inbound_message_id desc nulls last
      `),
    ),
  );
  for (const r of found)
    if (r.last_at)
      out.set(String(r.booking_id), {
        at: new Date(String(r.last_at)),
        id: r.last_id == null ? null : String(r.last_id),
        closedAt: r.closed_at ? new Date(String(r.closed_at)) : null,
      });
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
  /** Recipient and event texts were withheld: the viewer has no attendee PII access. */
  masked: boolean;
  closeAction: string | null;
  events: Array<{
    kind: string;
    verdict: string | null;
    confidence: number | null;
    content: string | null;
    step: string | null;
    createdAt: Date;
  }>;
}

/**
 * The latest case of a booking (or of any member of a visit), an open one first, with its events.
 * With `maskPii` the recipient is masked and event texts are dropped, as `getBookingDetail` does for
 * the attendee fields; the verdicts, steps and times stay.
 */
export async function getCaseForBooking(
  ctx: CoreCtx,
  bookingIds: string | string[],
  opts: { maskPii?: boolean } = {},
): Promise<ReconfirmCaseView | null> {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  if (!ids.length) return null;
  return withOrgCore(ctx, async (tx) => {
    const found = rows(
      await tx.execute(sql`
        select * from sched_reconfirm_cases
        where org_id = ${ctx.tenantId}
          and booking_id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
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
    const masked = opts.maskPii === true;
    return {
      id: String(c.id),
      open: c.closed_at == null,
      agentState,
      result,
      title: caseTitle({ agentState, result }),
      summary: masked || c.summary == null ? null : String(c.summary), // may carry the client's words or name
      openedAt: new Date(String(c.opened_at)),
      waitUntil: c.wait_until ? new Date(String(c.wait_until)) : null,
      contactId: c.contact_id == null ? null : String(c.contact_id),
      recipient: masked ? maskPii(String(c.recipient)) : String(c.recipient),
      masked,
      closeAction: c.close_action == null ? null : String(c.close_action),
      events: events.map((e) => ({
        kind: String(e.kind),
        verdict: e.verdict == null ? null : String(e.verdict),
        confidence: e.confidence == null ? null : Number(e.confidence),
        content: masked || e.content == null ? null : String(e.content),
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
    // One audit event per closed case (the log is the only record of why it closed).
    const logged = rows(
      await tx.execute(sql`
        with closed as (
          update sched_reconfirm_cases c
          set closed_at = ${iso(now)}::timestamptz,
              close_action = case when b.status in ('pending','accepted') then 'moved_by_staff' else 'booking_closed' end
          from sched_bookings b
          where c.org_id = ${ctx.tenantId} and c.closed_at is null
            and b.id = c.booking_id and b.org_id = c.org_id
            and (b.status not in ('pending','accepted') or b.start_time <> c.booking_start_at)
          returning c.id, c.org_id, c.booking_id, c.close_action
        )
        insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, data)
        select org_id, booking_id, id, 'system', jsonb_build_object('action', close_action) from closed
        returning id
      `),
    );
    return logged.length;
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

export interface AdvanceResult {
  asked: number;
  timedOut: number;
  failed: number;
  /** S4: slot offers sent and appointments the agent moved. */
  offered: number;
  rescheduled: number;
}

interface OpenCaseRow {
  id: string;
  booking_id: string;
  agent_state: string;
  channel: string;
  account_id: string | null;
  recipient: string;
  opened_at: string;
  wait_until: string | null;
  ask_at: string | null;
  start_time: string;
  attendee_name: string | null;
  service_title: string;
  timezone: string;
  opt_out: string;
}

const phone9 = (raw: string): string => raw.replace(/\D/g, '').slice(-9);
const errName = (e: unknown) => (e instanceof Error ? e.name : 'unknown');

/** End the agent's part: the case stays open for staff with this result. Idempotent per case. */
export async function endAgentPart(
  ctx: CoreCtx,
  c: Pick<OpenCaseRow, 'id' | 'booking_id'>,
  result: CaseResult,
  data: Record<string, unknown> = {},
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const done = rows(
      await tx.execute(sql`
        update sched_reconfirm_cases set result = ${result}, agent_state = 'done', wait_until = null
        where id = ${c.id}::uuid and org_id = ${ctx.tenantId} and closed_at is null and result is null
        returning id
      `),
    );
    if (!done[0]) return; // staff closed it, or another tick already ended it
    await tx.execute(sql`
      insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, data)
      values (${ctx.tenantId}, ${c.booking_id}::uuid, ${c.id}::uuid, 'system',
        ${JSON.stringify({ result, ...data })}::jsonb)
    `);
  });
}

/**
 * A person (not the agent, not a reminder) wrote in this chat after the client's first "no". The
 * window starts there, not at `opened_at`: a case opened from the tick (not at ingest) can be opened
 * well after the client wrote, and staff may already have answered in between.
 */
export async function humanWroteSince(
  ctx: CoreCtx,
  c: Pick<OpenCaseRow, 'id' | 'channel' | 'account_id' | 'recipient' | 'opened_at'>,
): Promise<boolean> {
  const p9 = phone9(c.recipient);
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select 1 from messages o
        where o.org_id = ${ctx.tenantId} and o.direction = 'outbound' and o.channel = ${c.channel}
          and coalesce(o.is_group, false) = false
          and (right(regexp_replace(coalesce(o.chat_id,''),'\\D','','g'), 9) = ${p9}
            or right(regexp_replace(coalesce(o.sender_id,''),'\\D','','g'), 9) = ${p9})
          and o.occurred_at > least(${c.opened_at}::timestamptz, coalesce(
            (select min(v.inbound_at) from sched_reconfirm_events v
              where v.case_id = ${c.id}::uuid and v.kind = 'verdict' and v.verdict = 'negation'),
            ${c.opened_at}::timestamptz))
          and coalesce(o.metadata->>'kind','') not in ('reminder','reconfirm')
          and coalesce(o.agent_id,'') <> 'reminders-agent'
          and not exists (
            select 1 from sched_reminders x
            where x.org_id = o.org_id and x.recipient_role = 'client'
              and ((x.message_id is not null and x.message_id = o.message_id) or x.content = o.content))
          and not exists (
            select 1 from sched_reconfirm_events e
            where e.org_id = o.org_id and e.kind = 'agent_message' and e.content = o.content)
          ${c.account_id ? sql`and o.account_id = ${c.account_id}` : sql``}
        limit 1
      `),
    ),
  );
  return found.length > 0;
}

/** The client wrote anything in this chat after `since` (the agent's question). */
async function clientWroteSince(ctx: CoreCtx, c: OpenCaseRow, since: string): Promise<boolean> {
  const found = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select 1 from messages m
        where m.org_id = ${ctx.tenantId} and m.direction = 'inbound' and m.channel = ${c.channel}
          and coalesce(m.is_group, false) = false
          and right(regexp_replace(coalesce(m.sender_id,''),'\\D','','g'), 9) = ${phone9(c.recipient)}
          and m.occurred_at > ${since}::timestamptz
          ${c.account_id ? sql`and m.account_id = ${c.account_id}` : sql``}
        limit 1
      `),
    ),
  );
  return found.length > 0;
}

export type AgentStep = 'ask' | 'offer' | 'confirm' | 'closing';

/**
 * Send ONE templated agent message for a case. The `(case_id, step)` unique index claims the step,
 * so overlapping ticks cannot send twice ('claimed' = someone else holds or already sent it). The
 * events log is append-only: the outcome is a `system` event, written in the same transaction as
 * `onSent` (the caller's case-state update). Mirrors the text into `messages` as the reminders agent.
 */
export async function sendAgentMessage(
  ctx: CoreCtx,
  c: {
    id: string;
    booking_id: string;
    channel: string;
    account_id: string | null;
    recipient: string;
    attendee_name: string | null;
  },
  step: AgentStep,
  text: string,
  now: Date,
  onSent?: (tx: Parameters<Parameters<typeof withOrgCore>[1]>[0]) => Promise<void>,
): Promise<'sent' | 'claimed' | 'failed'> {
  const claimed = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, step, send_status, content)
        values (${ctx.tenantId}, ${c.booking_id}::uuid, ${c.id}::uuid, 'agent_message', ${step}, 'sending', ${text})
        on conflict (case_id, step) where kind = 'agent_message' do nothing
        returning id
      `),
    ),
  );
  if (!claimed[0]) return 'claimed';
  let messageId: string | null;
  try {
    const res = await gatewayCall<{ messageId?: string; id?: string }>('channels.send', {
      channel: c.channel,
      to: c.recipient,
      text,
      ...(c.account_id ? { accountId: c.account_id } : {}),
      idempotencyKey: `reconf-${c.id}-${step}`,
    });
    messageId = res?.messageId ?? res?.id ?? null;
  } catch (e) {
    console.error('[reconfirm] send failed', c.id, errName(e));
    // ask/offer callers end the agent's part; confirm/closing have no caller to do it, so record it.
    if (step === 'confirm' || step === 'closing')
      await withOrgCore(ctx, (tx) =>
        tx.execute(sql`
          insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, step, data)
          values (${ctx.tenantId}, ${c.booking_id}::uuid, ${c.id}::uuid, 'system', ${step},
            ${JSON.stringify({ step, error: 'send' })}::jsonb)
        `),
      );
    return 'failed';
  }
  // The message is out: a DB failure from here on propagates and is never reported as a failed send.
  {
    await withOrgCore(ctx, async (tx) => {
      await onSent?.(tx);
      await tx.execute(sql`
        insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, step, send_status, message_id, data)
        values (${ctx.tenantId}, ${c.booking_id}::uuid, ${c.id}::uuid, 'system', ${step}, 'sent', ${messageId}, '{}'::jsonb)
      `);
    });
    try {
      await insertMessages(ctx.tenantId, null, [
        {
          clientId: `reconf-${c.id}-${step}`,
          direction: 'outbound',
          channel: c.channel,
          accountId: c.account_id,
          chatId: null,
          isGroup: false,
          senderId: c.recipient,
          senderName: c.attendee_name,
          senderHandle: null,
          isBot: true,
          content: text,
          messageId,
          agentId: 'reminders-agent',
          sessionKey: null,
          success: true,
          error: null,
          occurredAt: now.getTime(),
          metadata: { bookingId: c.booking_id, caseId: c.id, step, kind: 'reconfirm' },
        },
      ]);
    } catch (e) {
      console.error('[reconfirm] ledger insert failed', c.id, errName(e));
    }
    return 'sent';
  }
}

/**
 * Spec 139 S2: advance each open case one bounded step. The agent only ever asks (one templated
 * message per case, claimed through the unique `(case_id, step)` index so overlapping ticks cannot
 * send twice) and hands the case to staff with a result when it cannot or should not continue.
 * It never cancels, releases stock or hands back a session; the only booking write in this
 * module family is S4's move, in its own transaction.
 *
 *  - new case, more than 2 h before the start -> send the question, wait `negation_wait_hours`
 *    (never past start - 2 h);
 *  - a person wrote in the chat after the case opened -> `staff_handling`, the agent stops;
 *  - inside 2 h of the start -> `late_reply`; opted out -> `send_failed`; send error -> `send_failed`;
 *  - the wait passed -> `no_answer`, or `unclear` when the client wrote something we did not act on.
 */
export async function advanceCases(ctx: CoreCtx, now: Date, cap = 25): Promise<AdvanceResult> {
  const out: AdvanceResult = { asked: 0, timedOut: 0, failed: 0, offered: 0, rescheduled: 0 };
  const config = await getReminderConfig(ctx);
  if (!config.enabled) return out; // FR-007: reminders off means the agent writes nothing
  const open = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select c.id, c.booking_id, c.agent_state, c.channel, c.account_id, c.recipient, c.opened_at,
               c.wait_until, b.start_time, b.attendee_name, et.title as service_title, r.timezone,
               coalesce(ct.custom_fields->>'_reminders_opt_out','') as opt_out,
               (select max(e.created_at) from sched_reconfirm_events e
                 where e.case_id = c.id and e.kind = 'agent_message' and e.step = 'ask') as ask_at
        from sched_reconfirm_cases c
        join sched_bookings b on b.id = c.booking_id and b.org_id = c.org_id
        join sched_event_types et on et.id = b.event_type_id and et.org_id = b.org_id
        join sched_resources r on r.id = b.resource_id and r.org_id = b.org_id
        left join crm_contacts ct on ct.id = c.contact_id
        where c.org_id = ${ctx.tenantId} and c.closed_at is null and c.result is null
          and c.agent_state in ('none','asking','offered')
          and b.status in ('pending','accepted') and b.start_time = c.booking_start_at
        order by c.opened_at asc
        limit ${cap}
      `),
    ),
  ) as unknown as OpenCaseRow[];
  if (!open.length) return out;

  for (const c of open) {
    try {
      if (await humanWroteSince(ctx, c)) {
        await endAgentPart(ctx, c, 'staff_handling');
        continue;
      }
      const start = new Date(c.start_time);
      if (c.agent_state !== 'none') {
        if (c.wait_until && new Date(c.wait_until).getTime() <= now.getTime()) {
          const answered = c.ask_at ? await clientWroteSince(ctx, c, c.ask_at) : false;
          // TODO(handoff): spec 139 S4 reads the answer; until then (and for orgs without `ai.proactive`) any reply is `unclear` for staff.
          await endAgentPart(
            ctx,
            c,
            c.agent_state === 'offered' ? 'wants_other_date' : answered ? 'unclear' : 'no_answer',
          );
          out.timedOut += 1;
        }
        continue;
      }
      // agent_state = 'none': the question has not been sent.
      if (start.getTime() - now.getTime() < LATE_MS) {
        await endAgentPart(ctx, c, 'late_reply');
        continue;
      }
      if (c.opt_out && c.opt_out !== 'false' && c.opt_out !== '0') {
        await endAgentPart(ctx, c, 'send_failed', { error: 'opted_out' });
        out.failed += 1;
        continue;
      }
      const deadline = waitUntil(now, start, config.negationWaitHours);
      if (!deadline) continue; // unreachable after the check above; never send without a deadline
      const text = reconfirmAskTemplate({
        stage: 'reconfirm',
        attendeeName: c.attendee_name,
        serviceTitle: c.service_title,
        staffName: null,
        whenText: whenText(start, c.timezone, config.locale),
        fromName: config.fromName || (config.locale === 'en' ? 'your business' : 'tu negocio'),
        locale: config.locale,
      });
      const sent = await sendAgentMessage(ctx, c, 'ask', text, now, async (tx) => {
        await tx.execute(sql`
          update sched_reconfirm_cases set agent_state = 'asking', wait_until = ${iso(deadline)}::timestamptz
          where id = ${c.id}::uuid and org_id = ${ctx.tenantId} and closed_at is null and result is null
        `);
      });
      if (sent === 'sent') out.asked += 1;
      else if (sent === 'failed') {
        await endAgentPart(ctx, c, 'send_failed', { error: 'send' });
        out.failed += 1;
      }
    } catch (e) {
      // One case failing must not stop the others. Names only: no phones, no message text.
      console.error('[reconfirm] advance failed for case', c.id, errName(e));
    }
  }
  return out;
}
