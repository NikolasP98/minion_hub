import * as m from '$lib/paraglide/messages';

/**
 * The fields a sellable card can show, on every surface that renders one
 * (till gallery, catalog board). Labels are thunks: a module-scope `m.*()`
 * call bakes the SSR locale. A page offers a subset by key.
 */
export const SELLABLE_CARD_FIELDS = [
  { key: 'price', label: () => m.pos_sell_price() },
  { key: 'kind', label: () => m.pos_catalog_col_kind() },
  { key: 'stock', label: () => m.pos_catalog_col_stock() },
  { key: 'code', label: () => m.pos_sell_col_code() },
  { key: 'category', label: () => m.fin_col_category() },
  { key: 'zone', label: () => m.catalog_group_zone() },
  { key: 'line', label: () => m.catalog_group_line() },
  { key: 'tags', label: () => m.pos_catalog_col_tags() },
  { key: 'active', label: () => m.fin_col_active() },
] as const;

export type SellableCardField = (typeof SELLABLE_CARD_FIELDS)[number]['key'];

export function cardFieldCatalog(keys: readonly SellableCardField[]) {
  return keys.map((key) => ({
    key,
    label: SELLABLE_CARD_FIELDS.find((f) => f.key === key)!.label(),
  }));
}

/** One stock reading on every surface (was the till's private helper). */
export function stockTone(qty: number): 'success' | 'warning' | 'error' {
  if (qty > 10) return 'success';
  if (qty > 0) return 'warning';
  return 'error';
}
