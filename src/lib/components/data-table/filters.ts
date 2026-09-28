/**
 * Column-filter values for the shared DataTable.
 *
 * `enum` is the historical (and default) kind: a multi-select over a fixed
 * option list. `text` is a case-insensitive "contains". `number` and `date` are
 * closed min/max ranges — both endpoints INCLUSIVE, per the range contract in
 * the UI governance skill (a user who picks 0 → 100 means 0 and 100 are in).
 *
 * Lives in its own module so the filter popover and the table can share the
 * type without an import cycle.
 */

export type FilterValue =
  | { kind: 'enum'; values: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'number'; min: number | null; max: number | null }
  | { kind: 'date'; min: string | null; max: string | null };

export type FilterKind = FilterValue['kind'];

/** An empty filter is inert — it must never narrow the view or raise a chip. */
export function isFilterActive(value: FilterValue | null | undefined): boolean {
  if (!value) return false;
  switch (value.kind) {
    case 'enum':
      return value.values.length > 0;
    case 'text':
      return value.text.trim().length > 0;
    default:
      return value.min != null || value.max != null;
  }
}

/** The empty value for a kind — what "cleared" means. */
export function emptyFilter(kind: FilterKind): FilterValue {
  switch (kind) {
    case 'enum':
      return { kind: 'enum', values: [] };
    case 'text':
      return { kind: 'text', text: '' };
    case 'number':
      return { kind: 'number', min: null, max: null };
    case 'date':
      return { kind: 'date', min: null, max: null };
  }
}

function inRange(n: number, min: number | null, max: number | null): boolean {
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

/**
 * Does one row's matched value satisfy the filter?
 *
 * `raw` is whatever the column's `filter.match` (or accessor) produced: a
 * scalar, or an array when a row can belong to several buckets at once.
 */
export function matchesFilter(value: FilterValue, raw: unknown): boolean {
  if (!isFilterActive(value)) return true;
  const list = Array.isArray(raw) ? raw : [raw];
  switch (value.kind) {
    case 'enum': {
      const set = new Set(value.values);
      return list.some((v) => v != null && set.has(String(v)));
    }
    case 'text': {
      const needle = value.text.trim().toLowerCase();
      return list.some((v) => v != null && String(v).toLowerCase().includes(needle));
    }
    case 'number':
      return list.some((v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) && inRange(n, value.min, value.max);
      });
    case 'date':
      return list.some((v) => {
        const d = dayString(v);
        if (!d) return false;
        if (value.min && d < value.min) return false;
        if (value.max && d > value.max) return false;
        return true;
      });
  }
}

/** `YYYY-MM-DD` for a Date or a date-ish string; `null` when it isn't one. */
export function dayString(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'string' && v.trim()) return v.slice(0, 10);
  return null;
}

/**
 * One filter as a single query-string value for server mode.
 * `enum` keeps the historical comma-joined form; a range encodes as `min~max`.
 */
export function filterToParam(value: FilterValue): string {
  switch (value.kind) {
    case 'enum':
      return value.values.join(',');
    case 'text':
      return value.text.trim();
    default:
      return `${value.min ?? ''}~${value.max ?? ''}`;
  }
}
