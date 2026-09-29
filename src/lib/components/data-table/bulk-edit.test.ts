import { describe, it, expect } from 'vitest';
import { bulkEditableColumns, bulkEditJobs, planCustomBulkEdit, resolveRowOpen } from './bulk-edit';
import type { DataColumn } from './DataTable.svelte';

type Row = { id: string; name: string; qty: number };
const columns: DataColumn<Row>[] = [
  { key: 'id', label: 'Id' },
  { key: 'name', label: 'Name', editable: true },
  { key: 'qty', label: 'Qty', editable: true, type: 'number' },
];

describe('bulkEditableColumns', () => {
  it('keeps only editable columns the org has not switched off', () => {
    expect(bulkEditableColumns(columns, () => true)).toEqual([columns[1], columns[2]]);
    expect(bulkEditableColumns(columns, (key) => key !== 'qty')).toEqual([columns[1]]);
  });
});

describe('bulkEditJobs', () => {
  it('builds one change job per row for a single column', () => {
    const rows: Row[] = [
      { id: '1', name: 'a', qty: 1 },
      { id: '2', name: 'b', qty: 2 },
    ];
    expect(bulkEditJobs(rows, 'qty', '9')).toEqual([
      { row: rows[0], changes: { qty: '9' } },
      { row: rows[1], changes: { qty: '9' } },
    ]);
  });

  it('returns an empty array for an empty selection', () => {
    expect(bulkEditJobs([], 'qty', '9')).toEqual([]);
  });
});

describe('resolveRowOpen', () => {
  it('defaults to true with a title column and no onRowClick', () => {
    expect(resolveRowOpen(true, false)).toBe(true);
  });
  it('defaults to false without a title column', () => {
    expect(resolveRowOpen(false, false)).toBe(false);
  });
  it('defaults to false when the caller already wired onRowClick', () => {
    expect(resolveRowOpen(true, true)).toBe(false);
  });
  it('an explicit rowOpen always wins over the default', () => {
    expect(resolveRowOpen(true, true, true)).toBe(true);
    expect(resolveRowOpen(true, false, false)).toBe(false);
  });
});

describe('planCustomBulkEdit', () => {
  type CustomRow = { id: string | null };
  const rows: CustomRow[] = [{ id: 'a' }, { id: 'b' }, { id: null }, { id: 'c' }];
  const recordId = (r: CustomRow) => r.id;
  const version = (id: string) => ({ a: 3, b: 0, c: 5 })[id as 'a' | 'b' | 'c'] ?? 0;

  it('keeps only rows with a resolvable id AND edit access, carrying the current version', () => {
    const access = { a: { canEdit: true }, b: { canEdit: false }, c: { canEdit: true } };
    expect(planCustomBulkEdit(rows, recordId, access, version)).toEqual({
      eligible: [
        { recordId: 'a', version: 3 },
        { recordId: 'c', version: 5 },
      ],
      skipped: 2,
    });
  });

  it('skips everything when recordAccess has no entry for an id', () => {
    expect(planCustomBulkEdit(rows, recordId, {}, version)).toEqual({
      eligible: [],
      skipped: 4,
    });
  });

  it('empty selection ⇒ empty plan', () => {
    expect(planCustomBulkEdit([], recordId, {}, version)).toEqual({ eligible: [], skipped: 0 });
  });
});
