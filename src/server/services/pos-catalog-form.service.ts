import type { CoreCtx } from '$server/auth/core-ctx';
import { listSellables } from '$server/services/pos.service';
import { listConsumption, listItems } from '$server/services/stock.service';

/** Shared server load for the dedicated catalog create/edit pages. */
export async function loadPosCatalogFormData(ctx: CoreCtx, stockEnabled: boolean) {
  const [sellables, stockItems, consumption] = await Promise.all([
    listSellables(ctx, { includeInactive: true }),
    stockEnabled ? listItems(ctx) : Promise.resolve([]),
    stockEnabled ? listConsumption(ctx) : Promise.resolve([]),
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
  };
}
