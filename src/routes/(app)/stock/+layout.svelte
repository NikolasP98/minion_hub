<script lang="ts">
  import type { Snippet } from 'svelte';
  import StockNav from '$lib/components/stock/StockNav.svelte';
  let { children }: { children: Snippet } = $props();
</script>
<div class="h-full flex">
  <StockNav />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
