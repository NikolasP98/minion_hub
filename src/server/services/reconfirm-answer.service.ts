/**
 * Spec 139 S4: the agent reads a client's answer to its question and, only for orgs with
 * `ai.proactive`, offers free times and moves the appointment when the client explicitly picks one.
 *
 * The ONLY booking writes here are `pending -> accepted` and the in-place move to a slot the client
 * picked (the strict assistant reschedule), both in the same transaction as the case result. The
 * agent never cancels, archives, refunds, releases stock or hands back a session: there is no import
 * of any such function (checked by reconfirm-answer.service.test.ts).
 *
 * Never log message text or phone numbers; ids and error names only.
 */
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  AssistantRescheduleError,
  BookingConflictError,
  SlotUnavailableError,
  rescheduleAssistantBookingInTx,
  setBookingStatusInTx,
} from './scheduling-bookings.service';
import { getSlotsForEventType } from './scheduling-slots.service';
import { getReminderConfig } from './reminder-config.service';
import { orgAllows } from './entitlements.service';
import {
  closingTemplate,
  confirmTemplate,
  inferReconfirmAnswer,
  offerTemplate,
} from './reminder-compose';
import type { ClosingKind, ReconfirmAnswer } from './reminder-compose';
import { sendAgentMessage } from './reconfirm.service';
import {
  CONFIDENCE_MIN,
  dateWindow,
  pickOfferSlots,
  waitUntil,
  whenText,
} from '$server/scheduling/reconfirm';

const rows = (r: unknown) => r as unknown as Array<Record<string, unknown>>;
const iso = (d: Date) => d.toISOString();
const phone9 = (raw: string): string => raw.replace(/\D/g, '').slice(-9);
const errName = (e: unknown) => (e instanceof Error ? e.name : 'unknown');

export interface AnswerResult {
  answered: number;
  offered: number;
  rescheduled: number;
}

interface AnswerCase {
  id: string;
  booking_id: string;
  agent_state: string;
  channel: string;
  account_id: string | null;
  recipient: string;
  opened_at: string;
  offered_slots: Array<{ start: string; resourceId: string }>;
  since: string;
  start_time: string;
  status: string;
  group_id: string | null;
  event_type_id: string;
  resource_id: string;
  updated_at: string;
  attendee_name: string | null;
  service_title: string;
  staff_name: string | null;
  timezone: string;
  agent_text: string | null;
}

/** Close the agent's part of a case with a result, as one transaction. `close` also closes the case. */
async function settle(
  ctx: CoreCtx,
  c: Pick<AnswerCase, 'id' | 'booking_id'>,
  result: string,
  inboundAt: Date,
  opts: { close?: boolean; summary?: string | null; afterTx?: (tx: Tx) => Promise<void> } = {},
): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const done = rows(
      await tx.execute(sql`
        update sched_reconfirm_cases
        set result = ${result}, agent_state = 'done', wait_until = null,
            last_inbound_at = ${iso(inboundAt)}::timestamptz, summary = ${opts.summary ?? null},
            closed_at = ${opts.close ? sql`now()` : null}, close_action = ${opts.close ? 'agent' : null}
        where id = ${c.id}::uuid and org_id = ${ctx.tenantId} and closed_at is null and result is null
        returning id
      `),
    );
    if (!done[0]) return false;
    await opts.afterTx?.(tx);
    await tx.execute(sql`
      insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, data)
      values (${ctx.tenantId}, ${c.booking_id}::uuid, ${c.id}::uuid, 'system', ${JSON.stringify({ result })}::jsonb)
    `);
    return true;
  });
}
type Tx = Parameters<Parameters<typeof withOrgCore>[1]>[0];

/**
 * One transaction: lock the case, run the strict move to the offered slot, accept a `pending`
 * booking, clear the booking's time-based client reminder claims (the new date gets its reminders),
 * and close the case as `rescheduled`. A slot taken meanwhile, a booking changed since the offer or
 * any refusal rolls everything back and answers `slot_taken`.
 */
export async function acceptOfferedSlot(
  ctx: CoreCtx,
  caseId: string,
  pick: number,
  inboundAt: Date,
): Promise<'rescheduled' | 'slot_taken'> {
  try {
    return await withOrgCore(ctx, async (tx) => {
      const c = rows(
        await tx.execute(sql`
          select booking_id, offered_slots, offer_booking_updated_at from sched_reconfirm_cases
          where id = ${caseId}::uuid and org_id = ${ctx.tenantId} and closed_at is null
            and agent_state = 'offered' and result is null
          for update
        `),
      )[0];
      const slot = (c?.offered_slots as Array<{ start: string; resourceId: string }> | undefined)?.[
        pick
      ];
      if (!c || !slot || !c.offer_booking_updated_at) throw new SlotUnavailableError();
      const bookingId = String(c.booking_id);
      const moved = await rescheduleAssistantBookingInTx(tx, ctx, bookingId, {
        start: new Date(slot.start),
        resourceId: slot.resourceId,
        expectedUpdatedAt: new Date(String(c.offer_booking_updated_at)),
      });
      const cfg = await getReminderConfig(ctx);
      const timeStages = ((cfg.stages as Array<{ key: string; minutesBefore?: number }>) ?? [])
        .filter((s) => s.minutesBefore != null)
        .map((s) => s.key);
      if (timeStages.length)
        await tx.execute(sql`
          delete from sched_reminders
          where org_id = ${ctx.tenantId} and booking_id = ${bookingId}::uuid and recipient_role = 'client'
            and stage in (${sql.join(
              timeStages.map((k) => sql`${k}`),
              sql`, `,
            )})
        `);
      if (moved.booking.status === 'pending')
        await setBookingStatusInTx(tx, ctx, bookingId, 'accepted', {
          reason: 'client picked a new time',
        });
      await tx.execute(sql`
        update sched_reconfirm_cases
        set result = 'rescheduled', agent_state = 'done', wait_until = null,
            booking_start_at = ${iso(new Date(slot.start))}::timestamptz,
            last_inbound_at = ${iso(inboundAt)}::timestamptz,
            closed_at = now(), close_action = 'agent'
        where id = ${caseId}::uuid and org_id = ${ctx.tenantId}
      `);
      await tx.execute(sql`
        insert into sched_reconfirm_events (org_id, booking_id, case_id, kind, data)
        values (${ctx.tenantId}, ${bookingId}::uuid, ${caseId}::uuid, 'system',
          ${JSON.stringify({ result: 'rescheduled' })}::jsonb)
      `);
      return 'rescheduled' as const;
    });
  } catch (e) {
    if (
      e instanceof SlotUnavailableError ||
      e instanceof BookingConflictError ||
      e instanceof AssistantRescheduleError
    )
      return 'slot_taken';
    throw e;
  }
}

/**
 * Read each waiting case's new client replies (once: `last_inbound_at` is the cursor) and act.
 * Orgs without `ai.proactive`, or that turned AI reading of replies off, are skipped: they keep
 * the S2 behaviour (the question, then staff). Runs BEFORE `advanceCases` so an answered case is
 * not timed out as silent in the same tick.
 */
export async function advanceAnswers(ctx: CoreCtx, now: Date, cap = 25): Promise<AnswerResult> {
  const out: AnswerResult = { answered: 0, offered: 0, rescheduled: 0 };
  const config = await getReminderConfig(ctx);
  if (!config.enabled || !config.inferConfirmation) return out;
  if (!(await orgAllows(ctx.tenantId, 'ai.proactive', 'reminders'))) return out;

  const open = rows(
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select c.id, c.booking_id, c.agent_state, c.channel, c.account_id, c.recipient, c.opened_at,
               c.offered_slots, b.start_time, b.status, b.metadata->>'groupId' as group_id,
               b.event_type_id, b.resource_id, b.updated_at, b.attendee_name,
               et.title as service_title, r.name as staff_name, r.timezone,
               greatest(coalesce(c.last_inbound_at, c.opened_at),
                 coalesce((select max(e.created_at) from sched_reconfirm_events e
                           where e.case_id = c.id and e.kind = 'agent_message'), c.opened_at)) as since,
               (select e.content from sched_reconfirm_events e
                 where e.case_id = c.id and e.kind = 'agent_message' order by e.created_at desc limit 1) as agent_text
        from sched_reconfirm_cases c
        join sched_bookings b on b.id = c.booking_id and b.org_id = c.org_id
        join sched_event_types et on et.id = b.event_type_id and et.org_id = b.org_id
        join sched_resources r on r.id = b.resource_id and r.org_id = b.org_id
        where c.org_id = ${ctx.tenantId} and c.closed_at is null and c.result is null
          and c.agent_state in ('asking','offered')
          and b.status in ('pending','accepted') and b.start_time = c.booking_start_at
        order by c.opened_at asc
        limit ${cap}
      `),
    ),
  ) as unknown as AnswerCase[];

  for (const c of open) {
    try {
      const replies = rows(
        await withOrgCore(ctx, (tx) =>
          tx.execute(sql`
            select m.content, m.occurred_at from messages m
            where m.org_id = ${ctx.tenantId} and m.direction = 'inbound' and m.channel = ${c.channel}
              and coalesce(m.is_group, false) = false
              and right(regexp_replace(coalesce(m.sender_id,''),'\\D','','g'), 9) = ${phone9(c.recipient)}
              and m.occurred_at > ${c.since}::timestamptz
              ${c.account_id ? sql`and m.account_id = ${c.account_id}` : sql``}
            order by m.occurred_at asc limit 10
          `),
        ),
      );
      if (!replies.length) continue;
      const newest = new Date(String(replies[replies.length - 1]!.occurred_at));
      const texts = replies.map((r) => String(r.content ?? '').trim()).filter(Boolean);
      if (!texts.length) {
        await markRead(ctx, c.id, newest);
        continue;
      }
      out.answered += 1;
      await handleAnswer(ctx, now, config, c, texts, newest, out);
    } catch (e) {
      // One case failing must not stop the others. Names only: no phones, no message text.
      console.error('[reconfirm] answer failed for case', c.id, errName(e));
    }
  }
  return out;
}

async function markRead(ctx: CoreCtx, caseId: string, at: Date) {
  await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      update sched_reconfirm_cases set last_inbound_at = ${iso(at)}::timestamptz
      where id = ${caseId}::uuid and org_id = ${ctx.tenantId} and closed_at is null
    `),
  );
}

async function handleAnswer(
  ctx: CoreCtx,
  now: Date,
  config: Awaited<ReturnType<typeof getReminderConfig>>,
  c: AnswerCase,
  texts: string[],
  newest: Date,
  out: AnswerResult,
) {
  const start = new Date(c.start_time);
  const when = whenText(start, c.timezone, config.locale);
  const fromName = config.fromName || (config.locale === 'en' ? 'your business' : 'tu negocio');
  const offered = c.agent_state === 'offered' ? c.offered_slots : [];
  const ans: ReconfirmAnswer = await inferReconfirmAnswer(texts, {
    serviceTitle: c.service_title,
    whenText: when,
    locale: config.locale,
    agentText: c.agent_text ?? '',
    offered: offered.map((s) => whenText(new Date(s.start), c.timezone, config.locale, true)),
  });
  const sure = ans.confidence >= CONFIDENCE_MIN;
  const intent = sure ? ans.verdict : 'unclear';
  const msgCtx = { ...c, attendee_name: c.attendee_name };
  const close = (kind: ClosingKind) =>
    sendAgentMessage(
      ctx,
      msgCtx,
      'closing',
      closingTemplate({ kind, locale: config.locale, fromName, whenText: when }),
      now,
    );

  if (intent === 'will_come') {
    if (c.status === 'pending')
      await withOrgCore(ctx, (tx) =>
        setBookingStatusInTx(tx, ctx, c.booking_id, 'accepted', {
          reason: 'client confirmed after asking',
        }),
      );
    if (await settle(ctx, c, 'will_come', newest, { close: true })) await close('will_come');
    return;
  }
  if (intent === 'decline') {
    if (await settle(ctx, c, 'declined', newest)) await close('declined');
    return;
  }
  if (intent === 'pick' && c.agent_state === 'offered' && ans.pick !== null && offered[ans.pick]) {
    const r = await acceptOfferedSlot(ctx, c.id, ans.pick, newest);
    if (r === 'rescheduled') {
      out.rescheduled += 1;
      const slot = new Date(offered[ans.pick]!.start);
      await sendAgentMessage(
        ctx,
        msgCtx,
        'confirm',
        confirmTemplate({
          locale: config.locale,
          serviceTitle: c.service_title,
          whenText: whenText(slot, c.timezone, config.locale),
        }),
        now,
      );
    } else if (await settle(ctx, c, 'wants_other_date', newest)) await close('wants_other_date');
    return;
  }
  if (c.agent_state === 'offered') {
    // shortcut: one offer round. Anything that is not a pick after the offer goes to staff.
    if (await settle(ctx, c, 'wants_other_date', newest)) await close('wants_other_date');
    return;
  }
  if (intent === 'other_date') {
    // TODO(handoff): a grouped (merged) visit gets the question but no slot offer: the strict move refuses groups.
    const window = c.group_id ? null : dateWindow(ans.day, ans.partOfDay, now, c.timezone);
    const found = window
      ? await getSlotsForEventType(ctx, c.event_type_id, window.from, window.to, {
          now,
          pinnedResourceId: c.resource_id,
          excludeBookingId: c.booking_id,
        })
      : null;
    const picked = found ? pickOfferSlots(found.slots, ans.partOfDay, c.timezone, 3, now) : [];
    const deadline = waitUntil(now, start, config.negationWaitHours);
    if (!picked.length || !deadline) {
      if (await settle(ctx, c, 'wants_other_date', newest)) await close('wants_other_date');
      return;
    }
    const slots = picked.map((s) => ({ start: s.start.toISOString(), resourceId: c.resource_id }));
    const sent = await sendAgentMessage(
      ctx,
      msgCtx,
      'offer',
      offerTemplate({
        locale: config.locale,
        staffName: c.staff_name,
        slots: picked.map((s) => whenText(s.start, c.timezone, config.locale, true)),
      }),
      now,
      async (tx) => {
        await tx.execute(sql`
          update sched_reconfirm_cases
          set agent_state = 'offered', offered_slots = ${JSON.stringify(slots)}::jsonb,
              offer_booking_updated_at = ${iso(new Date(c.updated_at))}::timestamptz,
              wait_until = ${iso(deadline)}::timestamptz, last_inbound_at = ${iso(newest)}::timestamptz
          where id = ${c.id}::uuid and org_id = ${ctx.tenantId} and closed_at is null and result is null
        `);
      },
    );
    if (sent === 'sent') out.offered += 1;
    else if (sent === 'failed') await settle(ctx, c, 'send_failed', newest);
    return;
  }
  // unclear while asking: wait for the next reply or the deadline; this reply is not read again.
  await markRead(ctx, c.id, newest);
}
