import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { getMarketplaceAgent } from '$server/services/marketplace.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const db = getDb();
  const agent = await getMarketplaceAgent(db, params.id!);

  if (!agent) throw error(404, 'Agent not found');

  return json({ agent });
};
