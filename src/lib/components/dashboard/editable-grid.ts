import { catalogIds, layoutRecord } from '../data-view/layout-catalog';
export type Span = { w: number; h: number };
export type GridLayout = {
  version?: 1;
  order: string[];
  hidden?: string[];
  span: Record<string, Span>;
};
export type GridDefault = { id: string; w: number; h: number };
const finite = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;
export function clampSpan(s: Partial<Span> | null | undefined, cols: number, maxRows = 8): Span {
  return {
    w: Math.min(Math.max(1, finite(cols, 1)), Math.max(1, Math.round(finite(s?.w, 1)))),
    h: Math.min(maxRows, Math.max(1, Math.round(finite(s?.h, 1)))),
  };
}
/** Structural boundary for server/cache. Unknown catalog IDs are reconciled by the consumer. */
export function parseGridLayout(value: unknown): GridLayout | null {
  const record = layoutRecord(value);
  if (!record || !Array.isArray(record.order) || record.order.length > 200) return null;
  const validId = (id: unknown): id is string =>
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 100 &&
    !['__proto__', 'prototype', 'constructor'].includes(id);
  if (!record.order.every(validId) || new Set(record.order).size !== record.order.length)
    return null;
  if (
    record.hidden !== undefined &&
    (!Array.isArray(record.hidden) || record.hidden.length > 200 || !record.hidden.every(validId))
  )
    return null;
  if (!record.span || typeof record.span !== 'object' || Array.isArray(record.span)) return null;
  const entries = Object.entries(record.span);
  if (entries.length > 200) return null;
  const span: Record<string, Span> = {};
  for (const [id, s] of entries) {
    if (!validId(id) || !s || typeof s !== 'object') return null;
    const v = s as Record<string, unknown>;
    if (
      typeof v.w !== 'number' ||
      !Number.isFinite(v.w) ||
      v.w < 1 ||
      v.w > 24 ||
      typeof v.h !== 'number' ||
      !Number.isFinite(v.h) ||
      v.h < 1 ||
      v.h > 8
    )
      return null;
    span[id] = { w: Math.round(v.w), h: Math.round(v.h) };
  }
  return {
    ...(record.version === 1 ? { version: 1 as const } : {}),
    order: record.order,
    ...(record.hidden !== undefined ? { hidden: [...new Set(record.hidden as string[])] } : {}),
    span,
  };
}
export function reorder(order: string[], id: string, beforeId: string | null): string[] {
  if (!order.includes(id)) return [...order];
  const without = order.filter((x) => x !== id);
  const i = beforeId == null || beforeId === id ? -1 : without.indexOf(beforeId);
  return i < 0 ? [...without, id] : [...without.slice(0, i), id, ...without.slice(i)];
}
export function mergeLayout(
  defaults: GridDefault[],
  saved: unknown,
  cols: number,
  aliases: Readonly<Record<string, string>> = {},
): GridLayout {
  const ids = [...new Set(defaults.map((d) => d.id))];
  const record = layoutRecord(saved);
  const kept = catalogIds(record?.order, ids, aliases);
  const span: Record<string, Span> = {};
  const stored =
    record?.span && typeof record.span === 'object' ? (record.span as Record<string, unknown>) : {};
  for (const d of defaults) {
    const priorId = Object.keys(aliases).find(
      (id) => aliases[id] === d.id && Object.hasOwn(stored, id),
    );
    const candidate = Object.hasOwn(stored, d.id) ? stored[d.id] : priorId ? stored[priorId] : null;
    const s = candidate && typeof candidate === 'object' ? (candidate as Partial<Span>) : {};
    span[d.id] = clampSpan({ w: finite(s.w, d.w), h: finite(s.h, d.h) }, cols);
  }
  return {
    order: [...kept, ...ids.filter((id) => !kept.includes(id))],
    span,
    ...(record?.hidden !== undefined ? { hidden: catalogIds(record.hidden, ids, aliases) } : {}),
  };
}
