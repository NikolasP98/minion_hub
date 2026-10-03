<script lang="ts">
  import DataTable, { type DataColumn } from './DataTable.svelte';
  import { Button } from '$lib/components/ui';

  type Row = { id: string; name: string };
  let {
    onchange,
  }: {
    onchange: (ids: Set<string>, rows: Row[]) => void;
  } = $props();

  const columns: DataColumn<Row>[] = [{ key: 'name', label: 'Name' }];
  let data = $state<Row[]>([
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Beta' },
  ]);
  let selectedIds = $state(new Set<string>());
</script>

<Button type="button" onclick={() => (data = [{ id: '2', name: 'Beta' }])}>
  Replace projection
</Button>
<DataTable
  variant="plain"
  {data}
  {columns}
  getRowId={(row) => row.id}
  searchable
  selectable
  bind:selectedIds
  onSelectionChange={onchange}
/>
