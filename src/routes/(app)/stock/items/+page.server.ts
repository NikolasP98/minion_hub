import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listItems, itemSupplyInfo, itemOnHandInfo } from '$server/services/stock.service';
import { isLowStock, distinctUoms } from '$server/services/stock.logic';
import { getInheritedItemTags } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:items');
  // ?archived=1 opts INTO seeing archived items (with an Unarchive bulk
  // action); the default list stays active-only (spec Bundle C #5).
  const includeArchived = url.searchParams.get('archived') === '1';
  const [items, supply, onHand, stockTags] = await Promise.all([
    listItems(ctx, { includeArchived }),
    itemSupplyInfo(ctx),
    itemOnHandInfo(ctx),
    listTags(ctx, 'stock'),
  ]);
  // Own stock tags + the ones a recipe inherits from its ingredients.
  const itemTags = await getInheritedItemTags(
    ctx,
    items.map((i) => i.id),
  );
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'stock.items',
    items.map((item) => item.id),
  );
  // Last restock cost/supplier are derived from the ledger, not columns.
  return {
    // ?new=1 opens the create-item modal (assistant deep link).
    openNew: url.searchParams.get('new') === '1',
    showArchived: includeArchived,
    customProperties,
    /** Units already in use in this org — the create form's UOM picker options. */
    uoms: distinctUoms(items),
    /** Stock-scope tag registry — the Tags column filter options. */
    tags: stockTags
      .filter((t) => t.kind === 'manual')
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    items: items.map((i) => {
      const hand = onHand.get(i.id);
      const qtyOnHand = hand?.qtyOnHand ?? 0;
      const reorderLevel = i.reorderLevel == null ? null : Number(i.reorderLevel);
      return {
        ...i,
        lastRestockCost: supply.get(i.id)?.lastRestockCost ?? null,
        lastSupplierName: supply.get(i.id)?.supplierName ?? null,
        qtyOnHand,
        stockValue: hand?.value ?? 0,
        reorderLevel,
        lowStock: isLowStock(qtyOnHand, reorderLevel),
        tags: itemTags.get(i.id)?.own ?? [],
        inheritedTags: itemTags.get(i.id)?.inherited ?? [],
      };
    }),
  };
};
