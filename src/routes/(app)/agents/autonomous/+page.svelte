<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import AutonomousAgentCard from '$lib/components/agents/AutonomousAgentCard.svelte';
  import { gatewayAgentToVM, type AutonomousAgentVM } from '$lib/agents/autonomous';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig, getField } from '$lib/state/config/config.svelte';

  let { data }: { data: { systemAgents: AutonomousAgentVM[]; isAdmin: boolean; artifactsByAgent: Record<string, ArtifactDescriptor[]> } } = $props();

  onMount(() => {
    // Archetype lives in gateway config (agents.list[].archetype); ensure loaded.
    if (conn.connected && !configState.loaded && !configState.loading) loadConfig();
  });

  // id → archetype map from gateway config, same source AgentSidebar reads.
  const archetypeById = $derived.by(() => {
    const list = getField('agents.list');
    const map: Record<string, string> = {};
    if (Array.isArray(list)) {
      for (const a of list as Array<{ id?: string; archetype?: string }>) {
        if (a && typeof a.id === 'string' && typeof a.archetype === 'string') map[a.id] = a.archetype;
      }
    }
    return map;
  });

  const gatewayVMs = $derived(
    visibleAgents.value
      .map((a) => gatewayAgentToVM(a as { id: string; name?: string; status?: string }, archetypeById[(a as { id: string }).id]))
      .filter((vm): vm is AutonomousAgentVM => vm !== null),
  );

  const agents = $derived<AutonomousAgentVM[]>([...data.systemAgents, ...gatewayVMs]);
</script>

<div class="flex h-full flex-col overflow-y-auto p-6">
  <header class="mb-5">
    <h1 class="text-lg font-semibold text-white">{m.autonomous_page_title()}</h1>
    <p class="mt-1 text-sm text-white/50">{m.autonomous_page_subtitle()}</p>
  </header>

  {#if agents.length === 0}
    <div class="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/45">
      {m.autonomous_empty()}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each agents as agent (agent.id)}
        <AutonomousAgentCard {agent} artifacts={data.artifactsByAgent[agent.id] ?? []} canAdd={data.isAdmin} />
      {/each}
    </div>
  {/if}
</div>
