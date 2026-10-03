import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { listMarketplacePage, parseCatalogQuery } from '$server/services/marketplace/catalog-query';

export const GET: RequestHandler = async ({ url }) => {
  const filters = parseCatalogQuery(url.searchParams);
  return json(await listMarketplacePage(getCoreDb(), filters));
};
