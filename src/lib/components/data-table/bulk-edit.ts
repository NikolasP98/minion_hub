// TODO(handoff): custom properties and relation fields (tags, supplier) are not bulk-editable — proposals/2026-09-28-hub-table-open-modes-followups.md §6
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
 * Row-open default (Notion-style): a plain row click opens the title href when
 * there's a title column and the caller hasn't wired its own `onRowClick`. An
 * explicit `rowOpen` always wins.
 */
export function resolveRowOpen(
  hasTitleColumn: boolean,
  hasOnRowClick: boolean,
  rowOpen?: boolean,
): boolean {
  return rowOpen ?? (hasTitleColumn && !hasOnRowClick);
}
