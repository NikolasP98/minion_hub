<script lang="ts">
  import AgentDetail from './AgentDetail.svelte';
  import DotGrid from '$lib/components/decorations/DotGrid.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';

  const agent = $derived(gw.agents.find((a) => (a as { id: string }).id === ui.selectedAgentId) ?? null);
</script>

<section class="flex-1 min-w-0 flex flex-col overflow-hidden">
  {#if agent && ui.selectedAgentId}
    <AgentDetail agentId={ui.selectedAgentId} {agent} />
  {:else}
    <div class="relative flex-1 flex items-center justify-center text-muted-foreground text-sm">
      <DotGrid opacity={0.06} />
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
