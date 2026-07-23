import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  listItems,
  listWarehouses,
  getBins,
  getLedger,
  listConsumption,
  itemSupplyInfo,
} from '$server/services/stock.service';
import { getParty } from '$server/services/party.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:item-detail');

  const [items, warehouses, bins, ledger, consumedBy, supply] = await Promise.all([
    listItems(ctx),
    listWarehouses(ctx),
    getBins(ctx, { itemId: params.id }),
    getLedger(ctx, params.id),
    listConsumption(ctx, { itemId: params.id }),
    itemSupplyInfo(ctx),
  ]);
  const item = items.find((i) => i.id === params.id);
  if (!item) throw error(404, 'Item not found');
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  // Standing supplier name for the picker's initial label (the picker itself
  // only round-trips an id).
  const supplier = item.defaultSupplierPartyId
    ? await getParty(ctx, item.defaultSupplierPartyId)
    : null;
  const supplyInfo = supply.get(item.id) ?? null;

  return {
    item: {
      ...item,
      defaultSupplierName: supplier?.name ?? null,
      lastRestockCost: supplyInfo?.lastRestockCost ?? null,
      lastRestockAt: supplyInfo?.lastRestockAt ?? null,
      lastSupplierName: supplyInfo?.supplierName ?? null,
    },
    itemIds: items.map((i) => i.id), // ordered ids only (keep payload small) — [ / ] prev/next nav
    bins: bins.map((b) => ({
      ...b,
      warehouseName: warehouseById.get(b.warehouseId)?.name ?? b.warehouseId,
    })),
    ledger: ledger.map((l) => ({
      ...l,
      warehouseName: warehouseById.get(l.warehouseId)?.name ?? l.warehouseId,
    })),
    consumedBy,
  };
};
