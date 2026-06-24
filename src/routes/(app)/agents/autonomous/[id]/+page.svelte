<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeft, Settings2, Zap, Pencil, Maximize2, Minimize2 } from 'lucide-svelte';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import AgentHealthMetrics from '$lib/components/agents/AgentHealthMetrics.svelte';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import { getMasterFlow } from '$lib/flows/master-flows';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import type { HealthMetrics } from '$lib/server/agents/health-metrics';
  import { createBackNav } from '$lib/nav/back-nav.svelte';

  const back = createBackNav('/agents/autonomous', m.autonomous_detail_back);

  let {
    data,
  }: {
    data: {
      agent: AutonomousAgentVM;
      artifacts: ArtifactDescriptor[];
      isAdmin: boolean;
      health: HealthMetrics;
    };
  } = $props();
  const agent = $derived(data.agent);
  const flow = $derived(agent.flowId ? getMasterFlow(agent.flowId) : undefined);
  let flowFullscreen = $state(false);
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && flowFullscreen) flowFullscreen = false;
  }}
/>

<div class="flex h-full flex-col overflow-hidden p-6">
  <button type="button" onclick={back.go} class="mb-4 inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80">
    <ArrowLeft size={13} /> {back.label}
  </button>

  <header class="mb-5 flex items-start gap-3">
    <img src={agent.avatarUrl} alt="" class="size-12 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10" />
    <div class="min-w-0 flex-1">
      <h1 class="text-lg font-semibold text-white">{agent.name}</h1>
      {#if agent.role}<p class="text-sm text-white/50">{agent.role}</p>{/if}
      {#if agent.trigger}
        <p class="mt-1 inline-flex items-center gap-1.5 text-[11px] text-white/45"><Zap size={12} /> {agent.trigger}</p>
      {/if}
    </div>
    {#if agent.managePath}
      <a href={agent.managePath} class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10">
        <Settings2 size={13} /> {m.autonomous_detail_manage()}
      </a>
    {/if}
  </header>

  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
    <!-- Health metrics -->
    <AgentHealthMetrics health={data.health} />

    <!-- View-only flow -->
    {#if flow}
      <section
        class={flowFullscreen
          ? 'surface-4 fixed inset-0 z-[1000] flex flex-col'
          : 'flex flex-col rounded-xl border border-white/10 bg-white/[0.02]'}
      >
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <p class="text-[10px] font-medium uppercase tracking-wide text-white/40">
            {m.autonomous_view_flow()}
          </p>
          <div class="flex items-center gap-1.5">
            <!-- ponytail: edit is a forward-hook — only DB-flow-backed agents have
                 dbFlowId; system agents render read-only code flows (no edit). -->
            {#if data.isAdmin && agent.dbFlowId}
              <a
                href={`/flow-editor/${agent.dbFlowId}`}
                class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10"
              >
                <Pencil size={13} /> {m.autonomous_edit_flow()}
              </a>
            {/if}
            <button
              type="button"
              onclick={() => (flowFullscreen = !flowFullscreen)}
              aria-label={m.autonomous_maximize_flow()}
              title={m.autonomous_maximize_flow()}
              class="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {#if flowFullscreen}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
            </button>
          </div>
        </div>
        <div class={flowFullscreen ? 'min-h-0 flex-1' : 'h-80'}>
          <MasterFlowCanvas {flow} />
        </div>
      </section>
    {/if}

    <!-- Artifacts -->
    {#each data.artifacts as artifact (artifact.id)}
      <div class="min-h-[24rem]">
        <ArtifactHost descriptor={artifact} />
      </div>
    {/each}
  </div>
</div>
