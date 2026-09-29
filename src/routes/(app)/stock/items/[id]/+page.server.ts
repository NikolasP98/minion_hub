import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listItems,
  listWarehouses,
  getBins,
  getLedger,
  listConsumption,
  listEntryRefs,
  itemSupplyInfo,
} from '$server/services/stock.service';
import { distinctUoms } from '$server/services/stock.logic';
import { getParty } from '$server/services/party.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { getInheritedItemTags } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:item-detail');

  // includeArchived: true — this is the record's OWN resolution (reached from
  // a ledger/entry link, [ / ] nav, or a direct URL) so an archived item must
  // still be found, not silently 404 (spec Bundle C #5).
  const [
    items,
    warehouses,
    bins,
    ledger,
    consumedBy,
    supply,
    itemTags,
    stockTags,
    customProperties,
  ] = await Promise.all([
    listItems(ctx, { includeArchived: true }),
    listWarehouses(ctx),
    getBins(ctx, { itemId: params.id }),
    getLedger(ctx, params.id),
    listConsumption(ctx, { itemId: params.id }),
    itemSupplyInfo(ctx),
    getInheritedItemTags(ctx, [params.id]),
    listTags(ctx, 'stock'),
    loadCustomPropertyBundle(locals, ctx, 'stock.items', [params.id]),
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
  // Batch-resolve the ledger's entry human ids (Stock card's `entry` column,
  // spec Bundle C #2) — one query for every distinct entryId.
  const entryRefs = await listEntryRefs(ctx, [...new Set(ledger.map((l) => l.entryId))]);
  const humanIdByEntry = new Map(entryRefs.map((r) => [r.id, r.humanId]));

  return {
    // Units already in use in this org — the UOM picker's options. Derived from
    // the item list this load already fetches (no extra query).
    uoms: distinctUoms(items),
    item: {
      ...item,
      defaultSupplierName: supplier?.name ?? null,
      lastRestockCost: supplyInfo?.lastRestockCost ?? null,
      lastRestockAt: supplyInfo?.lastRestockAt ?? null,
      lastSupplierName: supplyInfo?.supplierName ?? null,
    },
    itemIds: items.map((i) => i.id), // ordered ids only (keep payload small) — [ / ] prev/next nav
    warehouseCount: warehouses.length,
    customProperties,
    bins: bins.map((b) => ({
      ...b,
      warehouseName: warehouseById.get(b.warehouseId)?.name ?? b.warehouseId,
    })),
    ledger: ledger.map((l) => ({
      ...l,
      warehouseName: warehouseById.get(l.warehouseId)?.name ?? l.warehouseId,
      entryHumanId: humanIdByEntry.get(l.entryId) ?? null,
    })),
    consumedBy,
    tags: itemTags.get(params.id)?.own ?? [],
    inheritedTags: itemTags.get(params.id)?.inherited ?? [],
    allTags: stockTags
      .filter((t) => t.kind === 'manual')
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
};
