<script lang="ts">
  import AgentDetail from './AgentDetail.svelte';
  import DotGrid from '$lib/components/decorations/DotGrid.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { bgPattern } from '$lib/state/bg-pattern.svelte';

  const agent = $derived(gw.agents.find((a) => (a as { id: string }).id === ui.selectedAgentId) ?? null);
</script>

<section class="flex-1 min-w-0 flex flex-col overflow-hidden">
  {#if agent && ui.selectedAgentId}
    <AgentDetail agentId={ui.selectedAgentId} {agent} />
  {:else}
    <div class="relative flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
      {#if bgPattern.pattern === 'none'}<DotGrid opacity={0.06} />{/if}
      {#if !conn.connected}
        <span class="text-2xl opacity-30 animate-pulse">&#x1F50C;</span>
        <span>Connect to a gateway to get started</span>
      {:else if gw.agents.length === 0}
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-30"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        <span>No agents found</span>
        <span class="text-xs text-muted-foreground/60">Add an agent using the + button in the sidebar</span>
      {:else}
        <span class="text-2xl opacity-30">&#x2190;</span>
        <span>Select an agent from the sidebar</span>
      {/if}
    </div>
  {/if}
</section>
