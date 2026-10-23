import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runPulseTick } from '$server/services/pulse-tick';
export const GET: RequestHandler = async ({ request, url }) => {
  if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`)
    throw error(401);
  if ([...url.searchParams].length) throw error(400, 'Pulse scope is configured by the operator');
  return json(await runPulseTick());
};
