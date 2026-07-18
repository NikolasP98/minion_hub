import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runRetention } from '$server/services/retention.service';

/**
 * GET /api/reliability/retention/tick — telemetry retention for the hub-owned
 * Turso tables. Bearer $CRON_SECRET. **DRY-RUN by default** (reports what WOULD
 * be pruned); pass `?apply=1` to actually delete. Signal is never touched
 * (high/critical/medium severity, `agent.llm.usage`, `*.error`/`*.failure`).
 * This path must also be in the hooks.server.ts unauth allowlist. Wire on netcup
 * as a daily crontab line hitting this URL with the secret.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const apply = url.searchParams.get('apply') === '1';
  const result = await runRetention({ apply });
  return json(result);
};
