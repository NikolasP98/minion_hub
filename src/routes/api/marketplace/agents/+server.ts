import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { listMarketplaceAgents } from '$server/services/marketplace.service';

export const GET: RequestHandler = async ({ url }) => {
  const category = url.searchParams.get('category') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const db = getCoreDb();
  const agents = await listMarketplaceAgents(db, { category, search, limit, offset });

  return json({ agents });
};
