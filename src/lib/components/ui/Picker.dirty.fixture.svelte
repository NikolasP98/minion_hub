<script lang="ts">
  import Picker from './Picker.svelte';
  import type { PickerCreateContext } from './picker';
  type Row = { id: string; name: string };
  let { onPick }: { onPick: (row: Row) => void } = $props();
  let open = $state(true);
</script>

{#snippet form(context: PickerCreateContext<Row>)}
  <button onclick={() => context.setDirty(true)}>Change custom control</button>
  <button onclick={() => context.oncreated({ id: 'created', name: 'Created' })}
    >Commit creation</button
  >
{/snippet}
<Picker
  bind:open
  title="Dirty fixture"
  columns={[{ key: 'name', label: 'Name', value: (row: Row) => row.name }]}
  rows={[]}
  getRowId={(row: Row) => row.id}
  {onPick}
  create={{ label: 'Create item', form }}
/>
