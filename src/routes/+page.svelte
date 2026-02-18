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

<div class="page">
  <Topbar />
  <div class="app">
    <AgentSidebar />
    <DetailPanel />
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .app {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
</style>
