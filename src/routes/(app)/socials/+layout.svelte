<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import AdsNav from '$lib/components/ads/AdsNav.svelte';
  import { navMode } from '$lib/state/ui/nav-mode.svelte';
  import { PageShell, SectionShell } from '$lib/components/ui/foundations';
  import { socialsRouteShell } from '$lib/routes/business-route-shells';
  let { children }: { children: Snippet } = $props();

  // In module mode the sidebar already lists these pages — rendering the
  // section nav too would duplicate the same links side by side.
  const navigation = $derived(navMode.isModule ? undefined : sectionNav);

  const routeShell = $derived(socialsRouteShell(canonicalPath(page.url.pathname)));
</script>

{#snippet sectionNav()}
  <AdsNav />
{/snippet}

<PageShell
  archetype={routeShell.archetype}
  scroll={routeShell.scroll}
  landmark={routeShell.landmark}
>
  <SectionShell mode="responsive" {navigation}>
    {@render children()}
  </SectionShell>
</PageShell>
