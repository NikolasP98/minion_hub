import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { listEnabledReminderOrgs } from '$server/services/reminder-config.service';
import { processOrgReminders, scanConfirmationReplies } from '$server/services/reminders.service';
import { isModuleEnabled } from '$server/services/modules.service';

/**
 * GET /api/scheduling/reminders/tick — Vercel Cron entrypoint (every minute).
 * The autonomous reminders agent's heartbeat: for each org that has reminders
 * enabled (and the scheduling module on), send any due booking reminders in a
 * bounded chunk. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically;
 * reject anything else.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);

  const orgIds = await listEnabledReminderOrgs();
  const now = new Date();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let confirmed = 0;
  let declined = 0;
  for (const orgId of orgIds) {
    const ctx = { db: getCoreDb(), tenantId: orgId };
    try {
      if (!(await isModuleEnabled(ctx, 'scheduling'))) continue;
      const r = await processOrgReminders(ctx, now);
      sent += r.sent;
      failed += r.failed;
      skipped += r.skipped;
      // Second pass: read replies to pending confirmations and flip their status.
      const c = await scanConfirmationReplies(ctx, now);
      confirmed += c.confirmed;
      declined += c.declined;
    } catch (e) {
      console.error('[reminders] tick failed for org', orgId, e);
    }
  }
  return json({ orgs: orgIds.length, sent, failed, skipped, confirmed, declined });
};
