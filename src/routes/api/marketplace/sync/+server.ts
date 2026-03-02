import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { syncMarketplaceAgents } from '$server/services/marketplace.service';

export const POST: RequestHandler = async () => {
  try {
    const db = getDb();
    const result = await syncMarketplaceAgents(db);
    return json(result);
  } catch (err) {
    throw error(500, `Sync failed: ${(err as Error).message}`);
  }
};
