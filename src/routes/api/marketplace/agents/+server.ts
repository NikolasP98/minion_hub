import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { listMarketplaceAgents } from '$server/services/marketplace.service';

export const GET: RequestHandler = async ({ url }) => {
  const category = url.searchParams.get('category') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const db = getDb();
  const agents = await listMarketplaceAgents(db, { category, search, limit, offset });

  return json({ agents });
};
