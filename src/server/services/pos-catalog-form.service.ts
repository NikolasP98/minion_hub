import type { CoreCtx } from '$server/auth/core-ctx';
import { isDenied, type DatasetDenied } from '$lib/permissions';
import { listSellables } from '$server/services/pos.service';
import { listConsumption, listItems } from '$server/services/stock.service';
import { listTags } from '$server/services/crm-contacts.service';

/** Shared server load for the dedicated catalog create/edit pages. */
export async function loadPosCatalogFormData(
  ctx: CoreCtx,
  stockEnabled: boolean,
  /** Each foreign dataset is read through ITS OWN handle (spec 039): the POS handle only authorizes POS. */
  stock: CoreCtx | DatasetDenied,
  crm: CoreCtx | DatasetDenied,
) {
  const [sellables, stockItems, consumption, tags] = await Promise.all([
    listSellables(ctx, { includeInactive: true }),
    // Ingredient picker — opt OUT of archived items (spec 2026-09-28 Bundle F
    // #5 followup: `listItems` default flipped to include archived).
    stockEnabled && !isDenied(stock)
      ? listItems(stock, { includeArchived: false })
      : Promise.resolve([]),
    stockEnabled && !isDenied(stock) ? listConsumption(stock) : Promise.resolve([]),
    isDenied(crm) ? Promise.resolve([]) : listTags(crm, 'catalog'),
  ]);

  return {
    sellables,
    stockItems: isDenied(stock) ? stock : stockItems,
    consumption: isDenied(stock) ? stock : consumption,
    stockEnabled,
    categories: Array.from(
      new Set(
        sellables.map((sellable) => sellable.category).filter((value): value is string => !!value),
      ),
    ).sort(),
    takenCodes: sellables.map((sellable) => sellable.code),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
}
