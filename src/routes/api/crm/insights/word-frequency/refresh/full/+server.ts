import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshCrmInsightsRollups } from '$server/services/crm-insights-rollup-refresh.service';

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  // Weekly repair window, not a full historical rebuild: the hourly
  // `/refresh` tick already keeps the trailing 3 days current, so this only
  // needs to catch late edits/backfills. 90 days at a weekly cadence.
  return json(await refreshCrmInsightsRollups(90));
};
