import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedReminders } from '$server/db/pg-reminders-schema';
import type { ReminderStage } from '$server/db/pg-reminders-schema';
import {
  dueStages,
  expandRoles,
  resolveRecipient,
  keywordVerdict,
  confirmCta,
} from '$server/scheduling/reminders';
import type { RecipientRole } from '$server/scheduling/reminders';
import {
  getReminderConfig as loadReminderConfig,
  effectiveChannels,
} from './reminder-config.service';
import { orgAllows } from './entitlements.service';

/**
 * Spec 043: for an org without `ai.proactive`, reminders still send but with the plain template, the
 * confirmation prompt and the keyword parser (`personalize` / `inferConfirmation` read as false).
 */
async function getReminderConfig(ctx: CoreCtx) {
  const config = await loadReminderConfig(ctx);
  if (!config.personalize && !config.inferConfirmation) return config;
  if (await orgAllows(ctx.tenantId, 'ai.proactive', 'reminders')) return config;
  return { ...config, personalize: false, inferConfirmation: false };
}
import { composeReminder, inferConfirmationReply } from './reminder-compose';
import type { Classified, ReminderContext, ReplyVerdict } from './reminder-compose';
import { CONFIDENCE_MIN, acted } from '$server/scheduling/reconfirm';
import { agedUnclearVerdicts, lastInboundAt, logVerdict, openCase } from './reconfirm.service';
import { BookingTransitionError, setBookingStatus } from './scheduling-bookings.service';
import { gatewayCall } from '$lib/server/gateway-rpc';
import { insertMessages } from './messages.service';

export interface ReminderRunResult {
  sent: number;
  failed: number;
  skipped: number;
}

interface CandidateRow {
  id: string;
  start_time: string;
  created_at: string;
  status: string;
  attendee_name: string | null;
  attendee_phone: string | null;
  attendee_email: string | null;
  crm_contact_id: string | null;
  service_title: string;
  staff_name: string | null;
  staff_email: string | null;
  timezone: string;
  opt_out: string;
}

/** Format an appointment start for the recipient, in the resource's timezone. */
function formatWhen(startIso: string, timezone: string, locale: string): string {
  const tag = locale === 'es' ? 'es-PE' : 'en-US';
  try {
    return new Intl.DateTimeFormat(tag, {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startIso));
  } catch {
    return new Date(startIso).toISOString();
  }
}

/**
 * Process one org's due reminders. Claims each (booking, stage) by inserting a
 * row first (unique on org+booking+stage) so overlapping ticks never double-send,
 * then composes + sends via the gateway and records the outcome + a ledger entry.
 */
export async function processOrgReminders(
  ctx: CoreCtx,
  now: Date,
  cap = 25,
): Promise<ReminderRunResult> {
  const config = await getReminderConfig(ctx);
  const result: ReminderRunResult = { sent: 0, failed: 0, skipped: 0 };
  if (!config.enabled) return result;
  // Only enabled stages fire; a stage is "enabled" unless explicitly turned off.
  const stages = ((config.stages as ReminderStage[]) ?? []).filter((s) => s.enabled !== false);
  if (!stages.length) return result;
  const channels = effectiveChannels(config);
  if (!channels.length) return result;

  // Candidate = active future bookings within a 60-day horizon. The horizon must
  // exceed the widest lead window AND cover the confirmation stage, which fires
  // as soon as a booking exists regardless of how far out it is.
  const candidates = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select b.id, b.start_time, b.created_at, b.status,
             b.attendee_name, b.attendee_phone, b.attendee_email, b.crm_contact_id,
             et.title as service_title, r.name as staff_name, r.email as staff_email, r.timezone,
             coalesce(c.custom_fields->>'_reminders_opt_out','') as opt_out
      from sched_bookings b
      join sched_event_types et on et.id = b.event_type_id and et.org_id = b.org_id
      join sched_resources r on r.id = b.resource_id and r.org_id = b.org_id
      left join crm_contacts c on c.id = b.crm_contact_id
      where b.org_id = ${ctx.tenantId} and b.status in ('accepted','pending')
        and b.start_time > now() and b.start_time <= now() + interval '60 days'
      order by b.start_time asc
      limit 200
    `),
  )) as unknown as CandidateRow[];
  if (!candidates.length) return result;

  // Already-recorded (stage, channel, role) combos per booking (dedup). With
  // multi-channel/multi-audience fan-out the key spans all three.
  const ids = candidates.map((c) => c.id);
  const recorded = (await withOrgCore(ctx, (tx) =>
    tx
      .select({
        bookingId: schedReminders.bookingId,
        stage: schedReminders.stage,
        channel: schedReminders.channel,
        role: schedReminders.recipientRole,
      })
      .from(schedReminders)
      .where(and(eq(schedReminders.orgId, ctx.tenantId), inArray(schedReminders.bookingId, ids))),
  )) as Array<{ bookingId: string; stage: string; channel: string; role: string }>;
  const doneCombos = new Set<string>();
  for (const r of recorded) doneCombos.add(`${r.bookingId}|${r.stage}|${r.channel}|${r.role}`);

  let budget = cap;
  for (const b of candidates) {
    if (budget <= 0) break;
    // Timing eligibility is per-stage; per-combo dedup is the claim insert below,
    // so pass an empty sent-set and let each (channel, role) claim guard itself.
    const due = dueStages({
      booking: {
        startTime: new Date(b.start_time),
        createdAt: new Date(b.created_at),
        status: b.status,
      },
      stages,
      now,
      sentStageKeys: [],
    });
    const optedOut = Boolean(b.opt_out && b.opt_out !== 'false' && b.opt_out !== '0');
    const contacts = {
      attendeePhone: b.attendee_phone,
      attendeeEmail: b.attendee_email,
      staffPhone: null,
      staffEmail: b.staff_email,
    };

    for (const stage of due) {
      if (budget <= 0) break;
      for (const chan of channels) {
        if (budget <= 0) break;
        for (const role of expandRoles(stage.recipients)) {
          if (budget <= 0) break;
          const comboKey = `${b.id}|${stage.key}|${chan.channel}|${role}`;
          if (doneCombos.has(comboKey)) continue;
          budget -= 1;
          const recipient = resolveRecipient(chan.channel, role as RecipientRole, contacts);

          // Claim the (booking, stage, channel, role) slot — skip on race.
          const claimed = await withOrgCore(ctx, (tx) =>
            tx
              .insert(schedReminders)
              .values({
                orgId: ctx.tenantId,
                bookingId: b.id,
                stage: stage.key,
                channel: chan.channel,
                recipientRole: role,
                recipient,
                status: 'sending',
              })
              .onConflictDoNothing({
                target: [
                  schedReminders.orgId,
                  schedReminders.bookingId,
                  schedReminders.stage,
                  schedReminders.channel,
                  schedReminders.recipientRole,
                ],
              })
              .returning({ id: schedReminders.id }),
          );
          if (!claimed.length) continue; // already handled

          const finalize = (
            status: string,
            fields: Partial<{ messageId: string; error: string; content: string }>,
          ) =>
            withOrgCore(ctx, (tx) =>
              tx
                .update(schedReminders)
                .set({ status, sentAt: status === 'sent' ? new Date() : null, ...fields })
                .where(
                  and(
                    eq(schedReminders.orgId, ctx.tenantId),
                    eq(schedReminders.bookingId, b.id),
                    eq(schedReminders.stage, stage.key),
                    eq(schedReminders.channel, chan.channel),
                    eq(schedReminders.recipientRole, role),
                    // A claim the stale-send sweep already failed stays failed.
                    eq(schedReminders.status, 'sending'),
                  ),
                ),
            );

          // Opt-out only silences the client; staff notifications still go out.
          if ((optedOut && role === 'client') || !recipient) {
            await finalize('skipped', {
              error: optedOut && role === 'client' ? 'opted_out' : 'no_recipient',
            });
            result.skipped += 1;
            continue;
          }

          const ctxMsg: ReminderContext = {
            stage: stage.key,
            attendeeName: role === 'team' ? b.staff_name : b.attendee_name,
            serviceTitle: b.service_title,
            staffName: b.staff_name,
            whenText: formatWhen(b.start_time, b.timezone, config.locale),
            fromName: config.fromName || 'tu negocio',
            locale: config.locale,
          };
          let text = '';
          try {
            text = await composeReminder(ctxMsg, config.personalize);
            // Pending booking + AI inference OFF + notifying the client → append a
            // deterministic SÍ/NO CTA (after personalization so the keyword scan
            // always has it). With inference ON the LLM reads natural replies.
            if (
              stage.key === 'confirmation' &&
              b.status === 'pending' &&
              role === 'client' &&
              !config.inferConfirmation
            ) {
              text = `${text}\n\n${confirmCta(config.locale)}`;
            }
            const res = await gatewayCall<{ messageId?: string; id?: string }>('channels.send', {
              channel: chan.channel,
              to: recipient,
              text,
              ...(chan.accountId ? { accountId: chan.accountId } : {}),
              idempotencyKey: `rem-${b.id}-${stage.key}-${chan.channel}-${role}`,
            });
            const messageId = res?.messageId ?? res?.id ?? null;
            await finalize('sent', { content: text, ...(messageId ? { messageId } : {}) });
            // Mirror into the messages ledger so the reminder shows in the CRM timeline.
            try {
              await insertMessages(ctx.tenantId, null, [
                {
                  clientId: `rem-${b.id}-${stage.key}-${chan.channel}-${role}`,
                  direction: 'outbound',
                  channel: chan.channel,
                  accountId: chan.accountId ?? null,
                  chatId: null,
                  isGroup: false,
                  senderId: recipient,
                  senderName: ctxMsg.attendeeName,
                  senderHandle: null,
                  isBot: true,
                  content: text,
                  messageId,
                  agentId: 'reminders-agent',
                  sessionKey: null,
                  success: true,
                  error: null,
                  occurredAt: Date.now(),
                  metadata: {
                    bookingId: b.id,
                    stage: stage.key,
                    channel: chan.channel,
                    role,
                    kind: 'reminder',
                  },
                },
              ]);
            } catch (e) {
              console.error('[reminders] ledger insert failed', b.id, stage.key, e);
            }
            result.sent += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[reminders] send failed', b.id, stage.key, chan.channel, role, msg);
            await finalize('failed', {
              error: msg.slice(0, 500),
              ...(text ? { content: text } : {}),
            });
            result.failed += 1;
          }
        }
      }
    }
  }
  return result;
}

export interface ConfirmScanResult {
  /** A `pending` booking the client confirmed (now `accepted`). */
  confirmed: number;
  /** Reconfirmation cases opened (a negation, or an unclear answer nobody clarified). */
  opened: number;
  /** Replies logged as unclear (including a negation below the confidence floor). */
  unclear: number;
}

interface ScanRow {
  id: string;
  start_time: string;
  status: string;
  attendee_name: string | null;
  crm_contact_id: string | null;
  group_id: string | null;
  service_title: string;
  timezone: string;
  channel: string;
  recipient: string;
  reminder_text: string | null;
  since: string;
}

const phone9 = (raw: string): string => raw.replace(/\D/g, '').slice(-9);

/**
 * Spec 139: read client replies to a sent reminder and act on what they mean.
 *
 * - Scope: `pending` or `accepted` bookings that got ANY client reminder in the last 7 days.
 * - Only messages newer than the last logged verdict are classified, so a reply is read once.
 * - Replies are matched on the phone AND the account the reminder used.
 * - yes on `pending` -> `accepted`. A confident negation opens a reconfirmation case and changes
 *   nothing else: no cancel, no stock release, no package hand-back, no message to the client.
 * - Below `CONFIDENCE_MIN` a verdict is logged as given and acted on as unclear.
 */
export async function scanConfirmationReplies(ctx: CoreCtx, now: Date): Promise<ConfirmScanResult> {
  const config = await getReminderConfig(ctx);
  const result: ConfirmScanResult = { confirmed: 0, opened: 0, unclear: 0 };
  if (!config.enabled) return result;

  const candidates = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select b.id, b.start_time, b.status, b.attendee_name, b.crm_contact_id,
             b.metadata->>'groupId' as group_id, et.title as service_title, r.timezone,
             rem.channel, rem.recipient, rem.content as reminder_text,
             (select min(x.sent_at) from sched_reminders x
               where x.booking_id = b.id and x.org_id = b.org_id and x.status = 'sent'
                 and x.recipient_role = 'client' and x.sent_at > now() - interval '7 days') as since
      from sched_bookings b
      join lateral (
        select channel, recipient, content from sched_reminders
        where booking_id = b.id and org_id = b.org_id and status = 'sent'
          and recipient_role = 'client' and channel = 'whatsapp' and recipient is not null
          and sent_at > now() - interval '7 days'
        order by sent_at desc limit 1
      ) rem on true
      join sched_event_types et on et.id = b.event_type_id and et.org_id = b.org_id
      join sched_resources r on r.id = b.resource_id and r.org_id = b.org_id
      where b.org_id = ${ctx.tenantId} and b.status in ('pending','accepted')
        and b.start_time > now() - interval '1 day'
      order by b.start_time asc
      limit 100
    `),
  )) as unknown as ScanRow[];
  if (!candidates.length) return result;

  const cursor = await lastInboundAt(
    ctx,
    candidates.map((c) => c.id),
  );
  // The reminder row keeps no account; the config's channel entry is the one it was sent with.
  const accountId =
    effectiveChannels(config).find((c) => c.channel === 'whatsapp')?.accountId ?? null;

  for (const b of candidates) {
    const p9 = phone9(b.recipient);
    if (p9.length < 8) continue;
    const after = cursor.get(b.id) ?? new Date(b.since);
    const msgs = (await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select content, occurred_at from messages
        where org_id = ${ctx.tenantId} and direction = 'inbound' and channel = ${b.channel}
          and right(regexp_replace(coalesce(sender_id,''),'\\D','','g'), 9) = ${p9}
          and occurred_at > ${after.toISOString()}::timestamptz
          ${accountId ? sql`and account_id = ${accountId}` : sql``}
        order by occurred_at asc
        limit 20
      `),
    )) as unknown as Array<{ content: string | null; occurred_at: string }>;
    const texts = msgs.map((m) => m.content?.trim()).filter((t): t is string => !!t);
    if (!texts.length) continue;
    const inboundAt = new Date(msgs[msgs.length - 1]!.occurred_at);

    let classified: Classified<ReplyVerdict>;
    if (config.inferConfirmation) {
      classified = await inferConfirmationReply(texts, {
        serviceTitle: b.service_title,
        whenText: formatWhen(b.start_time, b.timezone, config.locale),
        locale: config.locale,
        reminderText: b.reminder_text,
      });
    } else {
      // Keyword path: the most recent decisive reply wins (final intent).
      classified = { verdict: 'unclear', confidence: 0, via: 'keyword' };
      for (const t of texts) {
        const k = keywordVerdict(t);
        if (k.verdict !== 'unclear') classified = k;
      }
    }
    const verdict = acted(classified);
    const log = { bookingId: b.id, verdict: classified, texts, inboundAt };

    if (verdict === 'yes') {
      if (b.status === 'pending') {
        try {
          await setBookingStatus(ctx, b.id, 'accepted');
        } catch (e) {
          // Closed after the scan selected it (staff acted while we read replies): the closed
          // status stands, so nothing is counted or logged on the contact.
          if (!(e instanceof BookingTransitionError)) throw e;
          console.warn('[reminders] reply ignored, booking already closed', b.id, e.message);
          await logVerdict(ctx, log);
          continue;
        }
        result.confirmed += 1;
        await logContactActivity(
          ctx,
          b,
          'booking_confirmed',
          'Appointment confirmed by reply',
          classified,
        );
      }
      await logVerdict(ctx, log);
    } else if (verdict === 'negation') {
      const opened = await openCase(ctx, {
        bookingId: b.id,
        subjectKey: b.group_id ?? b.id,
        contactId: b.crm_contact_id,
        channel: b.channel,
        accountId,
        recipient: b.recipient,
        bookingStartAt: new Date(b.start_time),
        result: inboundAt.getTime() >= new Date(b.start_time).getTime() ? 'late_reply' : null,
        verdict: classified,
        texts,
        inboundAt,
      });
      if (opened.created) {
        result.opened += 1;
        await logContactActivity(
          ctx,
          b,
          'booking_reconfirm',
          'Dijo que no puede asistir; en seguimiento',
          classified,
        );
      }
    } else {
      await logVerdict(ctx, log);
      result.unclear += 1;
    }
  }

  // An unclear answer nobody clarified within the wait time goes to staff (spec section 4).
  const aged = await agedUnclearVerdicts(
    ctx,
    candidates.map((c) => c.id),
    new Date(now.getTime() - config.negationWaitHours * 3_600_000),
    CONFIDENCE_MIN,
  );
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const a of aged) {
    const b = byId.get(a.bookingId);
    if (!b) continue;
    const opened = await openCase(ctx, {
      bookingId: b.id,
      subjectKey: b.group_id ?? b.id,
      contactId: b.crm_contact_id,
      channel: b.channel,
      accountId,
      recipient: b.recipient,
      bookingStartAt: new Date(b.start_time),
      result: 'unclear',
      verdict: a.verdict,
      texts: a.texts,
      inboundAt: a.inboundAt,
    });
    if (opened.created) result.opened += 1;
  }
  return result;
}

/** Log to the contact timeline (best-effort). */
async function logContactActivity(
  ctx: CoreCtx,
  b: Pick<ScanRow, 'id' | 'crm_contact_id'>,
  kind: 'booking_confirmed' | 'booking_reconfirm',
  body: string,
  classified: Classified<ReplyVerdict>,
): Promise<void> {
  if (!b.crm_contact_id) return;
  try {
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        insert into crm_activities (org_id, contact_id, kind, body, data)
        values (${ctx.tenantId}, ${b.crm_contact_id}, ${kind}, ${body},
          ${JSON.stringify({ bookingId: b.id, via: classified.via === 'jev' ? 'ai_inference' : 'keyword' })}::jsonb)
      `),
    );
  } catch (e) {
    console.error('[reminders] reply activity log failed', b.id, e);
  }
}

export interface ReminderActivityItem {
  id: string;
  bookingId: string;
  stage: string;
  status: string;
  recipient: string | null;
  serviceTitle: string | null;
  startTime: string | null;
  createdAt: string;
  error: string | null;
}

export interface ReminderActivity {
  counts: { sent: number; failed: number; skipped: number };
  recent: ReminderActivityItem[];
}

/** Agent status: lifetime-ish counts (last 30d) + the recent activity feed. */
export async function getReminderActivity(ctx: CoreCtx, limit = 30): Promise<ReminderActivity> {
  return withOrgCore(ctx, async (tx) => {
    const counts = (await tx.execute(sql`
      select
        count(*) filter (where status = 'sent') as sent,
        count(*) filter (where status = 'failed') as failed,
        count(*) filter (where status = 'skipped') as skipped
      from sched_reminders
      where org_id = ${ctx.tenantId} and created_at > now() - interval '30 days'
    `)) as unknown as Array<Record<string, unknown>>;
    const recent = (await tx.execute(sql`
      select rem.id, rem.booking_id, rem.stage, rem.status, rem.recipient, rem.error,
             rem.created_at, b.title as service_title, b.start_time
      from sched_reminders rem
      left join sched_bookings b on b.id = rem.booking_id
      where rem.org_id = ${ctx.tenantId}
      order by rem.created_at desc
      limit ${Math.min(limit, 100)}
    `)) as unknown as Array<Record<string, unknown>>;
    const c = counts[0] ?? {};
    return {
      counts: {
        sent: Number(c.sent ?? 0),
        failed: Number(c.failed ?? 0),
        skipped: Number(c.skipped ?? 0),
      },
      recent: recent.map((r) => ({
        id: String(r.id),
        bookingId: String(r.booking_id),
        stage: String(r.stage),
        status: String(r.status),
        recipient: r.recipient != null ? String(r.recipient) : null,
        serviceTitle: r.service_title != null ? String(r.service_title) : null,
        startTime: r.start_time != null ? String(r.start_time) : null,
        createdAt: String(r.created_at),
        error: r.error != null ? String(r.error) : null,
      })),
    };
  });
}
