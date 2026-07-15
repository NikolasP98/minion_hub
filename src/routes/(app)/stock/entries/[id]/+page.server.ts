import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getEntry, listItems, listWarehouses } from '$server/services/stock.service';
import { getParty } from '$server/services/party.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:entry-detail');

  const [result, items, warehouses] = await Promise.all([getEntry(ctx, params.id), listItems(ctx), listWarehouses(ctx)]);
  if (!result) throw error(404, 'Entry not found');

  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const party = result.entry.partyId ? await getParty(ctx, result.entry.partyId) : null;

  return {
    entry: result.entry,
    partyName: party?.name ?? null,
    lines: result.lines.map((l) => ({
      ...l,
      itemLabel: itemById.get(l.itemId) ? `${itemById.get(l.itemId)!.code} — ${itemById.get(l.itemId)!.name}` : l.itemId,
      fromWarehouseName: l.fromWarehouseId ? (warehouseById.get(l.fromWarehouseId)?.name ?? l.fromWarehouseId) : null,
      toWarehouseName: l.toWarehouseId ? (warehouseById.get(l.toWarehouseId)?.name ?? l.toWarehouseId) : null,
    })),
  };
};
