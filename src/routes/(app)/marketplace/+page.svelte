<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  onMount(() => {
    goto('/marketplace/plugins', { replaceState: true });
  });
</script>

<PageShell archetype="dashboard" scroll="none" labelledBy="marketplace-entry-title">
  <h1 id="marketplace-entry-title" class="sr-only">{m.marketplace_title()}</h1>
  <PageBody padding="none" scroll="none">
    <AsyncBoundary state={{ kind: 'loading', label: m.common_loading() }} />
  </PageBody>
</PageShell>
