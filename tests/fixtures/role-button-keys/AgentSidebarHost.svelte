<script lang="ts">
  // HC-027 test host: AgentSidebar needs a QueryClient in context (private symbol key).
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import AgentSidebar from '$lib/components/agents/AgentSidebar.svelte';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
</script>

<QueryClientProvider {client}>
  <AgentSidebar collapseLevel="expanded" />
</QueryClientProvider>
