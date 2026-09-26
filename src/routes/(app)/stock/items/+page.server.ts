import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listItems, itemSupplyInfo, itemOnHandInfo } from '$server/services/stock.service';
import { isLowStock, distinctUoms } from '$server/services/stock.logic';
import { getInheritedItemTags } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:items');
  const [items, supply, onHand, stockTags] = await Promise.all([
    listItems(ctx),
    itemSupplyInfo(ctx),
    itemOnHandInfo(ctx),
    listTags(ctx, 'stock'),
  ]);
  // Own stock tags + the ones a recipe inherits from its ingredients.
  const itemTags = await getInheritedItemTags(
    ctx,
    items.map((i) => i.id),
  );
  // Last restock cost/supplier are derived from the ledger, not columns.
  return {
    // ?new=1 opens the create-item modal (assistant deep link).
    openNew: url.searchParams.get('new') === '1',
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
