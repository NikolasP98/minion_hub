<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import AutonomousAgentCard from '$lib/components/agents/AutonomousAgentCard.svelte';
  import { Badge, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { gatewayAgentToVM, type AutonomousAgentVM } from '$lib/agents/autonomous';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig, getField } from '$lib/state/config/config.svelte';

  let {
    data,
  }: {
    data: {
      systemAgents: AutonomousAgentVM[];
      workforceAgents: AutonomousAgentVM[];
      isAdmin: boolean;
      artifactsByAgent: Record<string, ArtifactDescriptor[]>;
    };
  } = $props();

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
        if (a && typeof a.id === 'string' && typeof a.archetype === 'string')
          map[a.id] = a.archetype;
      }
    }
    return map;
  });

  const gatewayVMs = $derived(
    visibleAgents.value
      .map((a) =>
        gatewayAgentToVM(
          a as { id: string; name?: string; status?: string },
          archetypeById[(a as { id: string }).id],
        ),
      )
      .filter((vm): vm is AutonomousAgentVM => vm !== null),
  );

  // Core autonomous agents = built-in system agents + gateway autonomous agents.
  const agents = $derived<AutonomousAgentVM[]>([...data.systemAgents, ...gatewayVMs]);
  const workforceAgents = $derived(data.workforceAgents ?? []);
  const pageState = $derived(
    agents.length === 0 && workforceAgents.length === 0
      ? { kind: 'empty' as const, title: m.autonomous_empty() }
      : { kind: 'ready' as const },
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy="autonomous-page-title">
  <PageHeader
    title={m.autonomous_page_title()}
    subtitle={m.autonomous_page_subtitle()}
    titleId="autonomous-page-title"
  />
  <PageBody width="content" scroll="region">
    <AsyncBoundary state={pageState}>
      {#if agents.length > 0}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each agents as agent (agent.id)}
            <AutonomousAgentCard
              {agent}
              artifacts={data.artifactsByAgent[agent.id] ?? []}
              canAdd={data.isAdmin}
            />
          {/each}
        </div>
      {/if}

      {#if workforceAgents.length > 0}
        <!-- Segregated group: agents that belong to the Workforce module. They are
           event-driven (act on issue create/update), hence autonomous. -->
        <section class="mt-8">
          <div class="mb-1 flex items-center gap-2">
            <h2 class="t-title">{m.autonomous_workforce_section()}</h2>
            <Badge variant="semantic" value="accent" size="sm"
              >{m.autonomous_workforce_badge()}</Badge
            >
            <span class="t-caption">{workforceAgents.length}</span>
          </div>
          <p class="mb-3 t-caption">{m.autonomous_workforce_section_desc()}</p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {#each workforceAgents as agent (agent.id)}
              <AutonomousAgentCard {agent} canAdd={false} />
            {/each}
          </div>
        </section>
      {/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>
