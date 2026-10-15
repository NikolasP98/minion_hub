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
  stored: StoredFieldLayout | null | undefined,
  defaultHidden: readonly string[] = [],
): FieldLayout {
  const known = new Set(catalog);
  const kept = (stored?.order ?? []).filter((k) => known.has(k));
  const order = [...kept, ...catalog.filter((k) => !kept.includes(k))];
  const hiddenSource = stored?.hidden ?? defaultHidden;
  return { hidden: new Set(hiddenSource.filter((k) => known.has(k))), order };
}

/** Moves `from` to `to`'s slot — the drag `FieldsList` reports. */
export function moveField(order: readonly string[], from: string, to: string): string[] {
  if (from === to) return [...order];
  const next = order.filter((k) => k !== from);
  const at = next.indexOf(to);
  if (at === -1) return [...order];
  next.splice(at, 0, from);
  return next;
}

export function visibleFields(layout: FieldLayout): string[] {
  return layout.order.filter((k) => !layout.hidden.has(k));
}
