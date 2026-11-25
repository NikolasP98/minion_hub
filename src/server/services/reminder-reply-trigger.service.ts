import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { withAiUsageOrg } from '$server/ai-usage';
import { isModuleEnabled } from './modules.service';
import { scanConfirmationReplies } from './reminders.service';
import { advanceCases } from './reconfirm.service';

const phone9 = (raw: string): string => raw.replace(/\D/g, '').slice(-9);

/**
 * Spec 139: event-driven reply handling. Called (inside `waitUntil`) by message ingest with the
 * senders of the one-to-one WhatsApp messages just stored. When one of them matches a booking that
 * got a client reminder in the scan window, read that phone's replies and advance the org's cases
 * now instead of at the next reminders tick, which stays the durable fallback. Never throws and
 * never logs phones or text: ingest must not be slowed or failed by this.
 */
export async function handleInboundForReminders(ctx: CoreCtx, senderIds: string[]): Promise<void> {
  const orgId = ctx.tenantId;
  try {
    const phones9 = [...new Set(senderIds.map(phone9).filter((p) => p.length >= 8))];
    if (!phones9.length) return;
    const hit = (await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
        select distinct right(regexp_replace(coalesce(rem.recipient,''),'\\D','','g'), 9) as p9
        from sched_reminders rem
        join sched_bookings b on b.id = rem.booking_id and b.org_id = rem.org_id
        where rem.org_id = ${orgId} and rem.status = 'sent' and rem.recipient_role = 'client'
          and rem.channel = 'whatsapp' and rem.sent_at > now() - interval '7 days'
          and right(regexp_replace(coalesce(rem.recipient,''),'\\D','','g'), 9) in (${sql.join(
            phones9.map((p) => sql`${p}`),
            sql`, `,
          )})
          and b.status in ('pending','accepted') and b.start_time > now() - interval '1 day'
      `),
    )) as unknown as Array<{ p9: string }>;
    const matched = hit.map((r) => String(r.p9));
    if (!matched.length) return;
    await withAiUsageOrg(orgId, 'scheduling.reminders', async () => {
      if (!(await isModuleEnabled(ctx, 'scheduling'))) return;
      const now = new Date();
      await scanConfirmationReplies(ctx, now, { phones9: matched });
      await advanceCases(ctx, now);
    });
  } catch (e) {
    console.error(
      '[reminders] reply-driven scan failed',
      orgId,
      e instanceof Error ? e.name : 'unknown',
    );
  }
}
