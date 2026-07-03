import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getLedger } from '$server/services/stock.service';

/** GET /api/stock/ledger?item=<id>&warehouse=<id> — movement history for one item. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const itemId = url.searchParams.get('item');
  if (!itemId) throw error(400, 'item query param is required');
  return json(await getLedger(ctx, itemId, url.searchParams.get('warehouse') ?? undefined));
};
