import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshCrmInsightsRollups } from '$server/services/crm-insights-rollup-refresh.service';

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  return json(await refreshCrmInsightsRollups(4_000));
};
