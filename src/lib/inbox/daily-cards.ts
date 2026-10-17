import { mergeFieldLayout } from '../components/data-view/card-fields';
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

/** A layout envelope saved by this feature: versioned and bound to one organization. */
export interface ScopedDailyLayout {
  version: number;
  organizationId: string;
  order: DailyCard[];
  hidden: DailyCard[];
}

export function mergeDailyLayout(stored: unknown): DailyLayout {
  const layout = mergeFieldLayout(DAILY_CARDS, stored);
  return { hidden: new Set([...layout.hidden] as DailyCard[]), order: layout.order as DailyCard[] };
}

/** Moves `from` to `to`'s slot, the drag the shared `FieldsList` reports. */
export function moveCard(order: DailyCard[], from: DailyCard, to: DailyCard): DailyCard[] {
  if (from === to || !order.includes(from)) return order;
  const next = order.filter((k) => k !== from);
  const at = next.indexOf(to);
  if (at === -1) return order;
  next.splice(at, 0, from);
  return next;
}

/** The server section stores the latest organization only; other organizations retain scoped local layouts. */
export function mergeScopedDailyLayout(stored: unknown, organizationId: string): DailyLayout {
  const matches =
    stored &&
    typeof stored === 'object' &&
    'organizationId' in stored &&
    stored.organizationId === organizationId;
  return mergeDailyLayout(matches ? stored : null);
}

/**
 * The profile section is canonical for its own organization. Returns the normalized
 * layout to adopt when a server value belongs to `organizationId`, differs from the
 * local copy and no local write is pending; otherwise null (never revert a fresh edit).
 */
export function serverLayoutToAdopt(
  stored: unknown,
  organizationId: string,
  pending: boolean,
  local: unknown,
): ScopedDailyLayout | null {
  if (pending || !stored || typeof stored !== 'object') return null;
  if (!('organizationId' in stored) || stored.organizationId !== organizationId) return null;
  const merged = mergeScopedDailyLayout(stored, organizationId);
  const next: ScopedDailyLayout = {
    version: 1,
    organizationId,
    order: merged.order,
    hidden: [...merged.hidden],
  };
  return JSON.stringify(next) === JSON.stringify(local) ? null : next;
}
