import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { purgeExpired } from '$server/services/email-ledger.service';

/**
 * GET /api/email-ledger/tick — cron entrypoint that enforces storage-limitation:
 * deletes email-ledger rows past their retention horizon (expires_at < now).
 * Bearer $CRON_SECRET. Wire on netcup with a daily crontab line (same shape as
 * the memberships tick). NOTE: this path is in the hooks.server.ts unauth
 * allowlist so the CRON_SECRET check below is the only gate.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const purged = await purgeExpired();
  return json({ purged });
};
