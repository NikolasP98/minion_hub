<script lang="ts">
  // Stand-in for StockItemPicker in mounted page tests: one button per item
  // while open, so a test can "pick" without driving the virtualized grid.
  type Item = { id: string; name: string };
  let {
    open = $bindable(false),
    items,
    onPick,
  }: { open?: boolean; items: Item[]; onPick: (item: Item) => void } = $props();
</script>

{#if open}
  {#each items as item (item.id)}
    <button type="button" onclick={() => onPick(item)}>pick {item.name}</button>
  {/each}
{/if}
