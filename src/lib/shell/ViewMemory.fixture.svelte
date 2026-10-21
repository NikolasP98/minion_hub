<script lang="ts">
  import { provideViewMemory } from './view-context';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import { Button } from '$lib/components/ui';
  import { Pencil } from 'lucide-svelte';
  let { onaction, registered = true }: { onaction: () => void; registered?: boolean } = $props();
  const memory = provideViewMemory();
  memory.reconcile(JSON.stringify(['actor', 'org']));
  let visible = $state(true);
</script>

<Button
  onclick={() => {
    memory.capture();
    visible = !visible;
  }}>Switch module</Button
>
{#if visible}
  <DataTable
    variant={registered ? 'plain' : 'full'}
    virtualize={false}
    storageKey={registered ? 'fixture' : undefined}
    data={[
      { id: 'one', name: 'Alpha' },
      { id: 'two', name: 'Beta' },
    ]}
    columns={[{ key: 'name', label: 'Name' }]}
    getRowId={(row) => row.id}
    searchable
    selectable
    rowContextMenu={() => [{ id: 'edit', label: 'Rename', icon: Pencil, run: onaction }]}
  />
{:else}<p>Other module</p>{/if}
