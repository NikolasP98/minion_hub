<script lang="ts">
  import type { Snippet } from 'svelte';
  import StockNav from '$lib/components/stock/StockNav.svelte';
  import { SectionShell } from '$lib/components/ui/foundations';
  let { children }: { children: Snippet } = $props();
</script>

<SectionShell mode="responsive">
  {#snippet navigation()}<StockNav />{/snippet}
  {@render children()}
</SectionShell>
