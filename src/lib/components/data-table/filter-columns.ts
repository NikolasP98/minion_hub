/**
 * Column → filter metadata, shared by `DataTable` and by a page that hosts a
 * SECOND view of the same rows (the appointments calendar/board, /pos/sell's
 * gallery): the "+ Filter" menu, the chips and the advanced builder all need
 * the same kind inference, enum option list and match resolution the table
 * uses, or the same `filters` object would select different rows in each view.
 *
 * Pure (no Svelte state) so both sides can derive from it.
 */
import type { DataColumn } from './DataTable.svelte';
import type { FilterColumnMeta, FilterKind } from './filters';

/** A column's value getter — `accessor`, else the row's own `key` property. */
export function columnAccessor<T>(c: DataColumn<T>): (row: T) => unknown {
  return c.accessor ?? ((row: T) => (row as Record<string, unknown>)[c.key]);
}

/** Which filter widget a column gets when it declares no `filter.kind`. */
export function columnFilterKind<T>(c: DataColumn<T>): FilterKind {
  return (
    c.filter?.kind ??
    (c.filter?.options
      ? 'enum'
      : c.type === 'boolean'
        ? 'boolean'
        : c.type === 'number' || c.numeric || c.money
          ? 'number'
          : c.type === 'date'
            ? 'date'
            : c.type === 'select' || c.filter
              ? 'enum'
              : 'text')
  );
}

/** Enum option list: the column's own `filter.options()` when given, else the
 *  distinct values seen in `rows` (capped — an unbounded scan over an
 *  unfiltered enum is a real cost on a large table). */
export function columnEnumOptions<T>(
  c: DataColumn<T>,
  rows: readonly T[],
): { value: string; label: string }[] {
  if (c.filter?.options) return c.filter.options();
  if (c.options) return c.options();
  const match = c.filter?.match ?? columnAccessor(c);
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = match(row);
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      if (v != null && v !== '') seen.add(String(v));
      if (seen.size >= 200) break;
    }
    if (seen.size >= 200) break;
  }
  return [...seen].sort().map((v) => ({ value: v, label: v }));
}

/** Metadata for the "+ Filter" menu, chips and advanced builder. EVERY column
 *  is filterable (Notion lists every property); a column's `filter` config
 *  only decides whether it ALSO gets a header popover. */
export function filterColumnMetas<T>(
  cols: readonly DataColumn<T>[],
  rows: readonly T[],
  label: (c: DataColumn<T>) => string = (c) => c.label,
): FilterColumnMeta[] {
  return cols.map((c) => {
    const kind = columnFilterKind(c);
    return {
      key: c.key,
      label: label(c),
      kind,
      options: kind === 'enum' ? columnEnumOptions(c, rows) : undefined,
    };
  });
}

/** Resolves a column key to its match function for `applyFilters` —
 *  `?? ''` keeps a null value matching an empty-string option (DataTable's
 *  own per-column behavior); an unknown key is inert, never hiding rows. */
export function columnMatchOf<T>(
  cols: readonly DataColumn<T>[],
): (key: string) => ((row: unknown) => unknown) | null {
  const byKey = new Map(cols.map((c) => [c.key, c]));
  return (key) => {
    const c = byKey.get(key);
    if (!c) return null;
    const fn = c.filter?.match ?? ((row: T) => columnAccessor(c)(row) ?? '');
    return (row: unknown) => fn(row as T);
  };
}
