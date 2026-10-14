/**
 * The daily dashboard's card layout, as the viewer arranged it.
 *
 * Pure so the merge is testable without mounting the page: a stored layout is
 * user data that can be stale (a card retired, a card added since it was
 * written), so it is MERGED with the catalog rather than trusted — unknown keys
 * are dropped and new cards appear in their catalog position instead of
 * silently never rendering.
 */
export const DAILY_CARDS = [
  'kpis',
  'appointments',
  'unscheduled',
  'unpaidVisits',
  'openShifts',
] as const;

export type DailyCard = (typeof DAILY_CARDS)[number];

export interface DailyLayout {
  hidden: Set<DailyCard>;
  order: DailyCard[];
}

export interface StoredDailyLayout {
  hidden?: string[];
  order?: string[];
}

export function mergeDailyLayout(stored: StoredDailyLayout | null | undefined): DailyLayout {
  const known = new Set<string>(DAILY_CARDS);
  const kept = (stored?.order ?? []).filter((k): k is DailyCard => known.has(k));
  // A card the stored order never mentions keeps its catalog position relative
  // to the cards that follow it, so adding one does not shove it to the end.
  const order = [...kept, ...DAILY_CARDS.filter((k) => !kept.includes(k))];
  return {
    hidden: new Set((stored?.hidden ?? []).filter((k): k is DailyCard => known.has(k))),
    order,
  };
}

/** Moves `from` to `to`'s slot, the drag the shared `FieldsList` reports. */
export function moveCard(order: DailyCard[], from: DailyCard, to: DailyCard): DailyCard[] {
  if (from === to) return order;
  const next = order.filter((k) => k !== from);
  const at = next.indexOf(to);
  if (at === -1) return order;
  next.splice(at, 0, from);
  return next;
}
