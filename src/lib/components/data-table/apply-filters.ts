/**
 * Applies a per-column filter map + an optional advanced rule tree to a row
 * array, in that order — the same two-stage shape `DataTable`'s internal
 * pipeline runs. Shared so a caller hosting a SECOND view of the same rows
 * next to a `DataTable` (e.g. a board/kanban view beside the table) can't
 * drift from what the table itself shows for the same `filters`/`advanced`.
 */
import {
  isFilterActive,
  matchesFilter,
  matchesGroup,
  type FilterGroup,
  type FilterValue,
} from './filters';

export function applyFilters<T>(
  rows: T[],
  filters: Record<string, FilterValue>,
  advanced: FilterGroup | null,
  matchOf: (key: string) => ((row: unknown) => unknown) | null,
  now: Date = new Date(),
): T[] {
  let list = rows;
  for (const [key, value] of Object.entries(filters)) {
    if (!isFilterActive(value)) continue;
    const match = matchOf(key);
    if (!match) continue;
    list = list.filter((row) => matchesFilter(value, match(row), now));
  }
  if (advanced) {
    const group = advanced;
    list = list.filter((row) => matchesGroup(group, row, matchOf, now));
  }
  return list;
}
