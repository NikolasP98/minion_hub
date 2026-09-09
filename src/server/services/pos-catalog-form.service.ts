import type { CoreCtx } from '$server/auth/core-ctx';
import { listSellables } from '$server/services/pos.service';
import { listConsumption, listItems } from '$server/services/stock.service';
import { listTags } from '$server/services/crm-contacts.service';

/** Shared server load for the dedicated catalog create/edit pages. */
export async function loadPosCatalogFormData(ctx: CoreCtx, stockEnabled: boolean) {
  const [sellables, stockItems, consumption, tags] = await Promise.all([
    listSellables(ctx, { includeInactive: true }),
    stockEnabled ? listItems(ctx) : Promise.resolve([]),
    stockEnabled ? listConsumption(ctx) : Promise.resolve([]),
    listTags(ctx),
  ]);

  return {
    sellables,
    stockItems,
    consumption,
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
