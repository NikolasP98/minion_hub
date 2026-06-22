import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedReminders } from '$server/db/pg-reminders-schema';
import type { ReminderStage } from '$server/db/pg-reminders-schema';
import { dueStages, expandRoles, resolveRecipient } from '$server/scheduling/reminders';
import type { RecipientRole } from '$server/scheduling/reminders';
import { getReminderConfig, effectiveChannels } from './reminder-config.service';
import { composeReminder } from './reminder-compose';
import type { ReminderContext } from './reminder-compose';
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
export async function processOrgReminders(ctx: CoreCtx, now: Date, cap = 25): Promise<ReminderRunResult> {
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
      .select({ bookingId: schedReminders.bookingId, stage: schedReminders.stage, channel: schedReminders.channel, role: schedReminders.recipientRole })
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
      booking: { startTime: new Date(b.start_time), createdAt: new Date(b.created_at), status: b.status },
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
              .values({ orgId: ctx.tenantId, bookingId: b.id, stage: stage.key, channel: chan.channel, recipientRole: role, recipient, status: 'sending' })
              .onConflictDoNothing({ target: [schedReminders.orgId, schedReminders.bookingId, schedReminders.stage, schedReminders.channel, schedReminders.recipientRole] })
              .returning({ id: schedReminders.id }),
          );
          if (!claimed.length) continue; // already handled

          const finalize = (status: string, fields: Partial<{ messageId: string; error: string; content: string }>) =>
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
                  ),
                ),
            );

          // Opt-out only silences the client; staff notifications still go out.
          if ((optedOut && role === 'client') || !recipient) {
            await finalize('skipped', { error: optedOut && role === 'client' ? 'opted_out' : 'no_recipient' });
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
                  metadata: { bookingId: b.id, stage: stage.key, channel: chan.channel, role, kind: 'reminder' },
                },
              ]);
            } catch (e) {
              console.error('[reminders] ledger insert failed', b.id, stage.key, e);
            }
            result.sent += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[reminders] send failed', b.id, stage.key, chan.channel, role, msg);
            await finalize('failed', { error: msg.slice(0, 500), ...(text ? { content: text } : {}) });
            result.failed += 1;
          }
        }
      }
    }
  }
  return result;
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
      counts: { sent: Number(c.sent ?? 0), failed: Number(c.failed ?? 0), skipped: Number(c.skipped ?? 0) },
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
