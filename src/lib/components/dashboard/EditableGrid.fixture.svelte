<script lang="ts">
  import EditableGrid from './EditableGrid.svelte';
  let { canSetDefault = false, readonly = false }: { canSetDefault?: boolean; readonly?: boolean } =
    $props();
</script>

<EditableGrid
  id="test-grid"
  items={[
    { id: 'a', label: 'Alpha', w: 2, h: 1 },
    { id: 'b', label: 'Beta', w: 1, h: 1 },
  ]}
  {canSetDefault}
  {readonly}
>
  {#snippet cell(id)}<article>{id === 'a' ? 'Alpha content' : 'Beta content'}</article>{/snippet}
</EditableGrid>
