import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreDb } from '$server/db/pg-client';
import { syncMarketplaceAgents } from '$server/services/marketplace.service';
import { syncResponse } from '$server/services/marketplace/http';

export const POST: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  try {
    return syncResponse(await syncMarketplaceAgents(getCoreDb(), true), true);
  } catch {
    throw error(503, 'Marketplace synchronization is temporarily unavailable');
  }
};
