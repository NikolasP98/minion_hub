// Shared nav-ordering: the user's drag-reordered sidebar order (stored per-user
// in Supabase prefs under "navOrder") is applied both by the desktop Sidebar and
// the mobile hamburger menu (Topbar) so the two stay consistent. Editing (drag)
// lives in Sidebar; both read+apply through here.
import type { Section, SectionItem } from './sections';

export type NavOrder = { sections?: string[]; items?: Record<string, string[]> };

/** Pull the saved nav order off `page.data` (empty when unset). */
export function readNavOrder(data: unknown): NavOrder {
  return ((data as { preferences?: { preferences?: { navOrder?: NavOrder } } })?.preferences
    ?.preferences?.navOrder ?? {}) as NavOrder;
}

/** Stable sort by a saved key order; unknown/new keys sort last (append). */
export function bySavedOrder<T>(list: T[], key: (t: T) => string, order: string[]): T[] {
  if (!order.length) return list;
  const idx = new Map(order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => (idx.get(key(a)) ?? Infinity) - (idx.get(key(b)) ?? Infinity));
}

export function orderSections(sections: Section[], order: NavOrder): Section[] {
  return bySavedOrder(sections, (s) => String(s.id), order.sections ?? []);
}

export function orderItems(section: Section, order: NavOrder): SectionItem[] {
  return bySavedOrder(section.items, (i) => i.href, order.items?.[String(section.id)] ?? []);
}
