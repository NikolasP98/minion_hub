import { catalogIds, layoutRecord } from './layout-catalog';
/**
 * Per-surface card field layout: which fields a card shows and in what order.
 * Pure — the `.svelte.ts` sibling persists it per viewer. Same merge rule as
 * the daily dashboard (`mergeDailyLayout`): stored keys that are no longer in
 * the catalog are dropped, a field the stored order never mentions keeps its
 * catalog position, so adding a field later renders for everyone.
 */
export interface StoredFieldLayout {
  hidden?: readonly string[];
  order?: readonly string[];
}

export interface FieldLayout {
  hidden: Set<string>;
  order: string[];
}

export function mergeFieldLayout(
  catalog: readonly string[],
  stored: unknown,
  defaultHidden: readonly string[] = [],
  aliases: Readonly<Record<string, string>> = {},
): FieldLayout {
  const record = layoutRecord(stored);
  const kept = catalogIds(record?.order, catalog, aliases);
  const order = [...kept, ...catalog.filter((k) => !kept.includes(k))];
  return {
    hidden: new Set(
      catalogIds(Array.isArray(record?.hidden) ? record.hidden : defaultHidden, catalog, aliases),
    ),
    order,
  };
}

/** Moves `from` to `to`'s slot — the drag `FieldsList` reports. */
export function moveField(order: readonly string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from)) return [...order];
  const next = order.filter((k) => k !== from);
  const at = next.indexOf(to);
  if (at === -1) return [...order];
  next.splice(at, 0, from);
  return next;
}

export function visibleFields(layout: FieldLayout): string[] {
  return layout.order.filter((k) => !layout.hidden.has(k));
}
