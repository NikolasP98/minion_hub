<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import AdsNav from '$lib/components/ads/AdsNav.svelte';
  import { PageShell, SectionShell } from '$lib/components/ui/foundations';
  import { socialsRouteShell } from '$lib/routes/business-route-shells';
  let { children }: { children: Snippet } = $props();

  const routeShell = $derived(socialsRouteShell(page.url.pathname));
</script>

<PageShell
  archetype={routeShell.archetype}
  scroll={routeShell.scroll}
  landmark={routeShell.landmark}
>
  <SectionShell mode="responsive">
    {#snippet navigation()}<AdsNav />{/snippet}
    {@render children()}
  </SectionShell>
</PageShell>
