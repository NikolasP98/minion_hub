<script lang="ts">
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import AgentSidebar from '$lib/components/AgentSidebar.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import { loadHosts, hostsState } from '$lib/state/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';

  onMount(() => {
    loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <div class="flex flex-1 min-h-0 overflow-hidden">
    <AgentSidebar />
    <DetailPanel />
  </div>
</div>
