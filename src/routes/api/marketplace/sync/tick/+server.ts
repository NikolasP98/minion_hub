import { timingSafeEqual } from 'node:crypto';
import { error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { syncMarketplaceAgents } from '$server/services/marketplace.service';
import { syncResponse } from '$server/services/marketplace/http';

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw error(401, 'Unauthorized');
  try {
    return syncResponse(await syncMarketplaceAgents(getCoreDb(), false), false);
  } catch {
    throw error(503, 'Marketplace synchronization is temporarily unavailable');
  }
};
