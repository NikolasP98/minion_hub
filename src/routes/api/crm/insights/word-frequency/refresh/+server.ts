import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshWordFrequencyRollup } from '$server/services/crm-word-frequency-rollup.service';
import { refreshSentimentRollup } from '$server/services/crm-sentiment-rollup.service';

export const GET: RequestHandler = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const schedule = request.headers.get('x-vercel-cron-schedule');
  const days = url.searchParams.get('full') === '1' || schedule === '15 8 * * *' ? 4_000 : 3;
  const [wordRows, sentimentRows] = await Promise.all([
    refreshWordFrequencyRollup(days),
    refreshSentimentRollup(days),
  ]);
  return json({ ok: true, days, wordRows, sentimentRows });
};
