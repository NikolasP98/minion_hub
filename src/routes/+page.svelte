<script lang="ts">
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import AgentSidebar from '$lib/components/AgentSidebar.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import { loadHosts, hostsState } from '$lib/state/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import DotGrid from '$lib/components/decorations/DotGrid.svelte';

  onMount(() => {
    loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });
</script>

<div class="flex flex-col h-screen overflow-hidden">
  <Topbar />
  <div class="relative flex flex-1 min-h-0 overflow-hidden">
    <DotGrid opacity={0.08} />
    <AgentSidebar />
    <DetailPanel />
  </div>
</div>
