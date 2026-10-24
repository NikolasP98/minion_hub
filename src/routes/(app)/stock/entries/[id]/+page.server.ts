import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getEntry, listItems, listWarehouses } from '$server/services/stock.service';
import { getParty } from '$server/services/party.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  depends('stock:entry-detail');
  const crm = await datasetCtx(locals, 'crm');

  // includeArchived: true — an entry's lines must keep naming an item that
  // was later archived (historical resolution, spec Bundle C #5).
  const [result, items, warehouses] = await Promise.all([
    getEntry(ctx, params.id),
    listItems(ctx, { includeArchived: true }),
    listWarehouses(ctx),
  ]);
  if (!result) throw error(404, 'Entry not found');

  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const party =
    result.entry.partyId && !isDenied(crm) ? await getParty(crm, result.entry.partyId) : null;

  return {
    stock: {
      entry: result.entry,
      partyName: party?.name ?? null,
      lines: result.lines.map((l) => ({
        ...l,
        itemLabel: itemById.get(l.itemId)
          ? `${itemById.get(l.itemId)!.code} — ${itemById.get(l.itemId)!.name}`
          : l.itemId,
        fromWarehouseName: l.fromWarehouseId
          ? (warehouseById.get(l.fromWarehouseId)?.name ?? l.fromWarehouseId)
          : null,
        toWarehouseName: l.toWarehouseId
          ? (warehouseById.get(l.toWarehouseId)?.name ?? l.toWarehouseId)
          : null,
      })),
    },
  };
};
