<script lang="ts">
  import DataTable, { type DataColumn } from './DataTable.svelte';

  let { canEdit = true }: { canEdit?: boolean } = $props();
  type Row = { id: string; name: string };
  const rows: Row[] = [{ id: 'row-1', name: 'value' }];
  const columns: DataColumn<Row>[] = [
    { key: 'name', label: 'Name', custom: true, customEditable: true },
  ];
</script>

<DataTable
  data={rows}
  {columns}
  getRowId={(row) => row.id}
  tableId="stock.items"
  {canEdit}
  cell={customCell}
/>

{#snippet customCell(_row: Row, _column: DataColumn<Row>, context: { canEdit: boolean })}
  <span data-testid="custom-policy">{String(context.canEdit)}</span>
{/snippet}
