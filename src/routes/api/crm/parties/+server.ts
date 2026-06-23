import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { searchParties } from '$server/services/party.service';

/** GET /api/crm/parties?q=&type=person,company — typeahead for party pickers. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams.get('q') ?? '';
  const typeParam = url.searchParams.get('type');
  const types = typeParam ? typeParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return json(await searchParties(ctx, q, { types }));
};
