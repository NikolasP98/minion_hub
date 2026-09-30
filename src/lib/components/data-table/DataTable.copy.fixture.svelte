<script module lang="ts">
  export type Row = {
    id: string;
    name: string;
    qty: number;
    active: boolean;
    code: string;
    secret: string;
  };
  // Module-level export (not an instance-script `export const`, which Svelte
  // treats as a component PROP, not a module export) — so the test file can
  // import it directly for row-count assertions.
  export const rows: Row[] = [
    { id: 'r1', name: 'Alpha', qty: 10, active: true, code: 'A1', secret: 'hidden-1' },
    { id: 'r2', name: 'Beta', qty: 20, active: false, code: 'B2', secret: 'hidden-2' },
    { id: 'r3', name: 'Gamma', qty: 30, active: true, code: 'C3', secret: 'hidden-3' },
  ];
</script>

<script lang="ts">
  import DataTable, { type DataColumn } from './DataTable.svelte';
  import type { RowSaveResult } from './row-save';

  // 'code' is visible but NOT editable (paste must skip it); 'secret' is
  // hidden (copy must never include it).
  const columns: DataColumn<Row>[] = [
    { key: 'name', label: 'Name', editable: true },
    { key: 'qty', label: 'Qty', editable: true, type: 'number' },
    { key: 'active', label: 'Active', editable: true, type: 'boolean' },
    { key: 'code', label: 'Code' },
    { key: 'secret', label: 'Secret', defaultHidden: true },
  ];

  let {
    onRowClick,
    onSaveRow,
    selectable = true,
    onSelectionChange,
  }: {
    onRowClick?: (row: Row) => void;
    onSaveRow?: (row: Row, draft: Record<string, string>) => Promise<RowSaveResult>;
    selectable?: boolean;
    onSelectionChange?: (ids: Set<string>) => void;
  } = $props();
</script>

<DataTable
  data={rows}
  {columns}
  getRowId={(row) => row.id}
  tableId="copy.fixture"
  canEdit
  {onSaveRow}
  {onRowClick}
  {selectable}
  onSelectionChange={onSelectionChange ? (ids) => onSelectionChange(ids) : undefined}
/>
