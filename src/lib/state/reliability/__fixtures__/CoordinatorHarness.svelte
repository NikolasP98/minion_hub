<script lang="ts">
  import { onMount } from 'svelte';
  import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
  import { createReliabilityCoordinator, type ReliabilityQuery } from '../coordinator.svelte';
  import { reliability } from '../reliability.svelte';
  import { Button } from '$lib/components/ui';
  import ReliabilityReadNotices from '$lib/components/reliability/ReliabilityReadNotices.svelte';
  let { owner, query, initializedOnMount = true, persistenceUnavailable = false, nextQuery, onQueryChange, activeTab = 'overview' }: {
    owner: GatewaySessionOwner | null;
    query: ReliabilityQuery;
    activeTab?: 'overview' | 'performance';
    initializedOnMount?: boolean;
    persistenceUnavailable?: boolean;
    nextQuery?: ReliabilityQuery;
    onQueryChange?: () => void;
  } = $props();
  let initialized = $state(false);
  onMount(() => { initialized = initializedOnMount; });
  const coordinator = createReliabilityCoordinator({ ready: () => initialized, owner: () => owner, query: () => query });
  let performanceRefreshKey = $state(0);
  function refreshCurrentTab() {
    if (activeTab === 'performance') performanceRefreshKey += 1;
    else void coordinator.refresh();
  }
</script>
<Button onclick={refreshCurrentTab}>Refresh metrics</Button>
{#if nextQuery}
  <Button onclick={() => { query = nextQuery!; onQueryChange?.(); }}>Change query</Button>
{/if}
<ReliabilityReadNotices states={reliability.states} {persistenceUnavailable} {coordinator} />
<output data-testid="summary">{JSON.stringify(reliability.summary)}</output>
<output data-testid="states">{JSON.stringify(reliability.states)}</output>
<output data-testid="query">{JSON.stringify(query)}</output>
<output data-testid="events">{JSON.stringify(reliability.events)}</output>
<output data-testid="all-data">{JSON.stringify([reliability.summary, reliability.summaryAll, reliability.events, reliability.timeline, reliability.flow, reliability.usage, reliability.activity, reliability.perf])}</output>

<output data-testid="performance-refresh">{performanceRefreshKey}</output>
