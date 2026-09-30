// Custom properties + tags are now bulk-editable (slice 2 Bundle E) — see
// `planCustomBulkEdit` below and `$lib/components/tags/tag-bulk.ts`. Relation
// fields other than tags (e.g. a "supplier" custom property) still route
// through the ordinary custom-property path once such a type exists.
import type { DataColumn, EditDraft } from './DataTable.svelte';

/**
 * Columns the floating bulk bar's "Edit property" popover may write to: the
 * caller marked them `editable`, and the org hasn't switched that field off
 * (`isFieldEditable`, from the table's resolved config — same check the grid
 * already runs per cell in `colEditable`). Callers gate the whole affordance
 * on `onSaveRow` being present / the table being editable before calling this.
 */
export function bulkEditableColumns<T>(
  columns: DataColumn<T>[],
  isFieldEditable: (key: string) => boolean,
): DataColumn<T>[] {
  return columns.filter((c) => !!c.editable && isFieldEditable(c.key));
}

/** One `{row, changes}` job per row for a single-column bulk edit. */
export function bulkEditJobs<T>(
  rows: T[],
  key: string,
  value: string,
): { row: T; changes: EditDraft }[] {
  return rows.map((row) => ({ row, changes: { [key]: value } }));
}

/**
 * Row-open default (owner directive 2026-09-29): a plain row click NEVER opens
 * the record any more — clicking a tag/category/toggle cell used to bubble up
 * and instantly navigate away before the picker it opened could be used. The
 * `.dt-open` arrow (and the title text link itself) are the only way in. An
 * explicit `rowOpen: true` still opts a table back into row-click navigation;
 * `hasTitleColumn`/`hasOnRowClick` are kept as parameters for callers that
 * still pass them, but no longer influence the default.
 */
export function resolveRowOpen(
  _hasTitleColumn: boolean,
  _hasOnRowClick: boolean,
  rowOpen?: boolean,
): boolean {
  return rowOpen ?? false;
}

/** One eligible row for a custom-property bulk edit: its resolved record id
 *  plus the current value's version (for the optimistic-concurrency PUT). */
export interface CustomBulkEditTarget {
  recordId: string;
  version: number;
}

/**
 * Splits the selected rows into what the custom-property bulk edit may
 * actually write (`eligible`) and what it must silently drop (`skipped`) —
 * a row with no resolvable record id, or one the record-level
 * `recordAccess` map (from the custom-property bundle) marks non-editable.
 * The caller reports `skipped` in its one toast summary (spec Bundle E #1).
 */
export function planCustomBulkEdit<T>(
  rows: T[],
  recordId: (row: T) => string | null | undefined,
  recordAccess: Record<string, { canEdit: boolean } | undefined>,
  version: (recordId: string) => number,
): { eligible: CustomBulkEditTarget[]; skipped: number } {
  let skipped = 0;
  const eligible: CustomBulkEditTarget[] = [];
  for (const row of rows) {
    const id = recordId(row);
    if (!id || !recordAccess[id]?.canEdit) {
      skipped++;
      continue;
    }
    eligible.push({ recordId: id, version: version(id) });
  }
  return { eligible, skipped };
}
