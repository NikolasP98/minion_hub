<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import StockNav from '$lib/components/stock/StockNav.svelte';
  import { PageShell, SectionShell } from '$lib/components/ui/foundations';
  import { stockRouteShell } from '$lib/routes/business-route-shells';
  let { children }: { children: Snippet } = $props();

  const routeShell = $derived(stockRouteShell(canonicalPath(page.url.pathname)));
</script>

<PageShell
  archetype={routeShell.archetype}
  scroll={routeShell.scroll}
  landmark={routeShell.landmark}
>
  <SectionShell mode="responsive">
    {#snippet navigation()}<StockNav />{/snippet}
    {@render children()}
  </SectionShell>
</PageShell>
