<script lang="ts">
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import MultiSelectFilter from './MultiSelectFilter.svelte';
  // One opener per widget, so focus return can be asserted.
  let { kind }: { kind: 'context' | 'filter' } = $props();
  let open = $state(false);
  let selected = $state(new Set<string>(['open']));
  const items: ContextMenuItem[] = [
    { id: 'charge', label: 'Charge' },
    { id: 'split', label: 'Split', children: [{ id: 'split-all', label: 'Split all' }] },
    { id: 'locked', label: 'Locked', disabled: true },
    { id: 'unschedule', label: 'Unschedule', danger: true },
  ];
  const options = [
    { value: 'open', label: 'Open' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ];
  function toggle(value: string) {
    const next = new Set(selected);
    if (!next.delete(value)) next.add(value);
    selected = next;
  }
</script>

{#if kind === 'context'}
  <button type="button" data-opener onclick={() => (open = true)}>Actions</button>
  {#if open}
    <ContextMenu
      x={10}
      y={10}
      {items}
      label="Appointment actions"
      onselect={() => (open = false)}
      onclose={() => (open = false)}
    />
  {/if}
{:else}
  <MultiSelectFilter
    label="Status"
    {options}
    {selected}
    onToggle={toggle}
    onClear={() => (selected = new Set())}
  />
{/if}
