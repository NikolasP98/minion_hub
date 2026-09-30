<script lang="ts">
  import DataTable, { type DataColumn, type DataCellContext } from './DataTable.svelte';

  type Row = { id: string; name: string; ro: string };
  const rows: Row[] = [
    { id: 'row-1', name: 'Alpha', ro: 'first' },
    { id: 'row-2', name: 'Beta', ro: 'second' },
  ];
  // 'name' is built-in editable (opens the shared input), 'tag' is a custom
  // column driven entirely through the `open`/`onOpenChange` DataCellContext
  // fields (the InlineTagsCell contract), 'ro' has neither — every cell is
  // still selectable (table has SOME editable capability via 'name'), but
  // only 'name'/'tag' can ever open something.
  const columns: DataColumn<Row>[] = [
    { key: 'name', label: 'Name', editable: true },
    { key: 'tag', label: 'Tag', custom: true, customEditable: true },
    { key: 'ro', label: 'Read-only' },
  ];
</script>

<DataTable
  data={rows}
  {columns}
  getRowId={(row) => row.id}
  tableId="cell-select.fixture"
  canEdit
  onSaveRow={async () => true}
  {cell}
/>

{#snippet cell(row: Row, column: DataColumn<Row>, context: DataCellContext)}
  {#if column.key === 'tag'}
    <span data-testid={`tag-open-${row.id}`}>{String(!!context.open)}</span>
    <button
      type="button"
      data-testid={`tag-close-${row.id}`}
      onclick={() => context.onOpenChange?.(false)}>close</button
    >
  {/if}
{/snippet}
