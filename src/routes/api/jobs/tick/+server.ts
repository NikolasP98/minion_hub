import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runTick } from '$server/services/bg-runtime';
import { evaluateInboxRules } from '$server/services/inbox/evaluate';
// Importing the service registers its bg-runtime handler (side effect).
import '$server/services/groupchat.service';
import '$server/services/brains.service';
import '$server/services/brain-corpus-jobs.service';
import '$server/services/brain-business-corpus-jobs.service';
import '$server/services/finance-statements.service';

/**
 * GET /api/jobs/tick — cron entrypoint for the GLOBAL background-job runtime.
 * Bearer $CRON_SECRET. Advances every resumable bg_jobs row within a budget so
 * long-running work (group chat, future jobs) survives navigation. Also runs
 * the inbox evaluator (spec 2026-10-10-hub-inbox-notifications-reminders
 * Slice 2) — a per-org sweep, not a bg_jobs row, so it runs independently of
 * `runTick` and never lets one org's failure affect another's or the job
 * runtime's own result.
 * Wire on netcup: per-minute crontab line hitting this URL with the secret
 * (same shape as the other ticks). NOTE: this path must also be in the
 * hooks.server.ts unauth allowlist.
 */
// Vercel cron (vercel.json) calls this every 5 minutes with the CRON_SECRET bearer.
// NO per-route `export const config` here: it makes adapter-vercel split this
// route into its own function and every locale-prefixed URL (/en/*, /es/*)
// falls to an empty catch-all and 404s (prod incident 2026-07-16, repeated
// 2026-10-11 by this file). The global adapter `maxDuration: 300` already
// covers this tick (svelte.config.js).

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const res = await runTick(50_000);
  let inbox: Awaited<ReturnType<typeof evaluateInboxRules>> | { error: string };
  try {
    inbox = await evaluateInboxRules();
  } catch (err) {
    console.error('[jobs/tick] inbox evaluator failed', err);
    inbox = { error: err instanceof Error ? err.message : String(err) };
  }
  return json({ ...res, inbox });
};
