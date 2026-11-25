import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { listEnabledReminderOrgs } from '$server/services/reminder-config.service';
import { processOrgReminders, scanConfirmationReplies } from '$server/services/reminders.service';
import { advanceCases } from '$server/services/reconfirm.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { withAiUsageOrg } from '$server/ai-usage';

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
  let opened = 0;
  let unclear = 0;
  const cases = { opened: 0, asked: 0, timedOut: 0, failed: 0, offered: 0, rescheduled: 0 };
  for (const orgId of orgIds) {
    // Per-org AI usage scope — cron has no `locals.tenantCtx`, so without this
    // the reminder composer's tokens record against no organization at all.
    await withAiUsageOrg(orgId, 'scheduling.reminders', async () => {
      const ctx = { db: getCoreDb(), tenantId: orgId };
      try {
        if (!(await isModuleEnabled(ctx, 'scheduling'))) return;
        const r = await processOrgReminders(ctx, now);
        sent += r.sent;
        failed += r.failed;
        skipped += r.skipped;
        // Second pass: read replies to pending confirmations and flip their status; a "no" opens a reconfirmation case (spec 139).
        const c = await scanConfirmationReplies(ctx, now);
        confirmed += c.confirmed;
        opened += c.opened;
        unclear += c.unclear;
        cases.opened += c.opened;
        // Third pass (spec 139): the agent asks the client who said no, and hands silent cases to staff.
        const a = await advanceCases(ctx, now);
        cases.asked += a.asked;
        cases.timedOut += a.timedOut;
        cases.failed += a.failed;
        cases.offered += a.offered;
        cases.rescheduled += a.rescheduled;
      } catch (e) {
        // Name and driver code only: a driver message can carry query params (phones, message text).
        const code =
          e instanceof Error ? (e.cause as { code?: string } | undefined)?.code : undefined;
        console.error(
          '[reminders] tick failed for org',
          orgId,
          e instanceof Error ? e.name : 'unknown',
          code,
        );
      }
    });
  }
  // `declined` stays in the response for readers of the old shape; a reply no longer declines anything.
  return json({
    orgs: orgIds.length,
    sent,
    failed,
    skipped,
    confirmed,
    declined: 0,
    opened,
    unclear,
    cases,
  });
};
