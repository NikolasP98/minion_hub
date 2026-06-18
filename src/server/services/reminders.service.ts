import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedReminders } from '$server/db/pg-reminders-schema';
import type { ReminderStage } from '$server/db/pg-reminders-schema';
import { dueStages } from '$server/scheduling/reminders';
import { getReminderConfig } from './reminder-config.service';
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
  crm_contact_id: string | null;
  service_title: string;
  staff_name: string | null;
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
  const stages = (config.stages as ReminderStage[]) ?? [];
  if (!stages.length) return result;

  // Candidate = active future bookings within a 60-day horizon. The horizon must
  // exceed the widest lead window AND cover the confirmation stage, which fires
  // as soon as a booking exists regardless of how far out it is.
  const candidates = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select b.id, b.start_time, b.created_at, b.status,
             b.attendee_name, b.attendee_phone, b.crm_contact_id,
             et.title as service_title, r.name as staff_name, r.timezone,
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

  // Already-recorded stage keys per booking (dedup).
  const ids = candidates.map((c) => c.id);
  const recorded = (await withOrgCore(ctx, (tx) =>
    tx
      .select({ bookingId: schedReminders.bookingId, stage: schedReminders.stage })
      .from(schedReminders)
      .where(and(eq(schedReminders.orgId, ctx.tenantId), inArray(schedReminders.bookingId, ids))),
  )) as Array<{ bookingId: string; stage: string }>;
  const sentByBooking = new Map<string, Set<string>>();
  for (const r of recorded) {
    const set = sentByBooking.get(r.bookingId) ?? new Set();
    set.add(r.stage);
    sentByBooking.set(r.bookingId, set);
  }

  let budget = cap;
  for (const b of candidates) {
    if (budget <= 0) break;
    const due = dueStages({
      booking: { startTime: new Date(b.start_time), createdAt: new Date(b.created_at), status: b.status },
      stages,
      now,
      sentStageKeys: sentByBooking.get(b.id) ?? new Set(),
    });
    for (const stage of due) {
      if (budget <= 0) break;
      budget -= 1;
      const optedOut = b.opt_out && b.opt_out !== 'false' && b.opt_out !== '0';
      const recipient = b.attendee_phone?.trim() || null;

      // Claim the (booking, stage) slot — skip if another tick already took it.
      const claimed = await withOrgCore(ctx, (tx) =>
        tx
          .insert(schedReminders)
          .values({ orgId: ctx.tenantId, bookingId: b.id, stage: stage.key, channel: config.channel, recipient, status: 'sending' })
          .onConflictDoNothing({ target: [schedReminders.orgId, schedReminders.bookingId, schedReminders.stage] })
          .returning({ id: schedReminders.id }),
      );
      if (!claimed.length) continue; // already handled

      const finalize = (status: string, fields: Partial<{ messageId: string; error: string; content: string }>) =>
        withOrgCore(ctx, (tx) =>
          tx
            .update(schedReminders)
            .set({ status, sentAt: status === 'sent' ? new Date() : null, ...fields })
            .where(and(eq(schedReminders.orgId, ctx.tenantId), eq(schedReminders.bookingId, b.id), eq(schedReminders.stage, stage.key))),
        );

      if (optedOut || !recipient) {
        await finalize('skipped', { error: optedOut ? 'opted_out' : 'no_recipient' });
        result.skipped += 1;
        continue;
      }

      const ctxMsg: ReminderContext = {
        stage: stage.key,
        attendeeName: b.attendee_name,
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
          channel: config.channel,
          to: recipient,
          text,
          ...(config.accountId ? { accountId: config.accountId } : {}),
          idempotencyKey: `rem-${b.id}-${stage.key}`,
        });
        const messageId = res?.messageId ?? res?.id ?? null;
        await finalize('sent', { content: text, ...(messageId ? { messageId } : {}) });
        // Mirror into the messages ledger so the reminder shows in the CRM timeline.
        try {
          await insertMessages(ctx.tenantId, null, [
            {
              clientId: `rem-${b.id}-${stage.key}`,
              direction: 'outbound',
              channel: config.channel,
              accountId: config.accountId ?? null,
              chatId: null,
              isGroup: false,
              senderId: recipient,
              senderName: b.attendee_name,
              senderHandle: null,
              isBot: true,
              content: text,
              messageId,
              agentId: 'reminders-agent',
              sessionKey: null,
              success: true,
              error: null,
              occurredAt: Date.now(),
              metadata: { bookingId: b.id, stage: stage.key, kind: 'reminder' },
            },
          ]);
        } catch (e) {
          console.error('[reminders] ledger insert failed', b.id, stage.key, e);
        }
        result.sent += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reminders] send failed', b.id, stage.key, msg);
        await finalize('failed', { error: msg.slice(0, 500), ...(text ? { content: text } : {}) });
        result.failed += 1;
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
