<script lang="ts">
  import { QueryClientProvider, type QueryClient } from '@tanstack/svelte-query';
  import Catalog from '../../../routes/(app)/marketplace/agents/+page.svelte';
  import Detail from '../../../routes/(app)/marketplace/agents/[slug]/+page.svelte';
  let {
    client,
    owned,
    detail = false,
  }: { client: QueryClient; owned: () => void; detail?: boolean } = $props();
  $effect(() => {
    owned();
  });
</script>

<QueryClientProvider {client}>
  {#if detail}<Detail />{:else}<Catalog />{/if}
</QueryClientProvider>
