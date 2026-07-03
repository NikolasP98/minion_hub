import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getBins } from '$server/services/stock.service';

/** GET /api/stock/bins?item=&warehouse= — the bin-levels cache (low-stock dashboard). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  return json(
    await getBins(ctx, {
      itemId: url.searchParams.get('item') ?? undefined,
      warehouseId: url.searchParams.get('warehouse') ?? undefined,
    }),
  );
};
