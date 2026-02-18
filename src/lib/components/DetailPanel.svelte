<script lang="ts">
  import AgentDetail from './AgentDetail.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';

  const agent = $derived(gw.agents.find((a) => (a as { id: string }).id === ui.selectedAgentId) ?? null);
</script>

<section class="detail-panel">
  {#if agent && ui.selectedAgentId}
    <AgentDetail agentId={ui.selectedAgentId} {agent} />
  {:else}
    <div class="detail-empty">
      {#if !conn.connected}
        Connect to a gateway to get started
      {:else if gw.agents.length === 0}
        No agents found
      {:else}
        Select an agent from the sidebar
      {/if}
    </div>
  {/if}
</section>

<style>
  .detail-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .detail-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text3);
    font-size: 14px;
  }
</style>
