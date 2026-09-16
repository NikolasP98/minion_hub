import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshCrmInsightsRollups } from '$server/services/crm-insights-rollup-refresh.service';

/** Hourly, not sub-hourly: `crm_refresh_word_frequency_daily` (see the
 * 2026-08-25 migration) takes `pg_advisory_xact_lock` and does a full
 * delete/re-insert over the requested day range on every call, with no
 * early exit. `wordFrequencyRollup` only ever reads complete UTC day
 * buckets, so refreshing more often than once an hour re-does the same
 * work for no fresher data. */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  return json(await refreshCrmInsightsRollups(3));
};
