/**
 * Pure layout helpers for {@link EditableGrid.svelte} — kept out of the component
 * so the reorder/merge/clamp logic is unit-testable without a DOM.
 *
 * A dashboard view is a CSS grid of `cols` columns. Each item occupies a
 * `{w, h}` span (in column / row units). The viewer can drag to reorder and
 * resize; the result persists to localStorage and is merged back over the
 * code-defined defaults on load (so newly-added cards still appear, and removed
 * ones drop out).
 */

export type Span = { w: number; h: number };
export type GridLayout = { order: string[]; span: Record<string, Span> };
export type GridDefault = { id: string; w: number; h: number };

export function clampSpan(s: Span, cols: number, maxRows = 8): Span {
  return {
    w: Math.min(cols, Math.max(1, Math.round(s.w))),
    h: Math.min(maxRows, Math.max(1, Math.round(s.h))),
  };
}

/** Move `id` to sit immediately before `beforeId` (or to the end if null/self). */
export function reorder(order: string[], id: string, beforeId: string | null): string[] {
  const without = order.filter((x) => x !== id);
  if (beforeId == null || beforeId === id) return [...without, id];
  const i = without.indexOf(beforeId);
  if (i < 0) return [...without, id];
  return [...without.slice(0, i), id, ...without.slice(i)];
}

/** Merge a saved (possibly stale/partial) layout over the current item defaults. */
export function mergeLayout(
  defaults: GridDefault[],
  saved: GridLayout | null,
  cols: number,
): GridLayout {
  const ids = defaults.map((d) => d.id);
  const order = saved
    ? [
        ...saved.order.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !saved.order.includes(id)),
      ]
    : ids;
  const span: Record<string, Span> = {};
  for (const d of defaults) {
    span[d.id] = clampSpan(saved?.span?.[d.id] ?? { w: d.w, h: d.h }, cols);
  }
  return { order, span };
}
