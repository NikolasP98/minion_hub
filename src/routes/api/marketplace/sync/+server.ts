import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { syncMarketplaceAgents } from '$server/services/marketplace.service';

export const POST: RequestHandler = async () => {
  try {
    const db = getCoreDb();
    const result = await syncMarketplaceAgents(db);
    return json(result);
  } catch (err) {
    throw error(500, `Sync failed: ${(err as Error).message}`);
  }
};
