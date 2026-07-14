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
  import { Button, PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

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

<PageShell archetype="record-detail" scroll="page" labelledBy="autonomous-detail-title">
  <PageHeader title={agent.name} subtitle={agent.role} titleId="autonomous-detail-title">
    {#snippet leading()}
      <Button variant="ghost" size="sm" onclick={back.go}>
        <ArrowLeft size={13} />
        {back.label}
      </Button>
    {/snippet}
    {#snippet primaryActions()}
      {#if agent.managePath}
        <Button variant="secondary" size="sm" href={agent.managePath}>
          <Settings2 size={13} />
          {m.autonomous_detail_manage()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>
  <PageBody width="content">
    <header class="mb-5 flex items-start gap-3">
      <img
        src={agent.avatarUrl}
        alt=""
        class="size-12 shrink-0 rounded-lg bg-bg3 ring-1 ring-border"
      />
      <div class="min-w-0 flex-1">
        {#if agent.trigger}
          <p class="mt-1 inline-flex items-center gap-1.5 t-caption">
            <Zap size={12} />
            {agent.trigger}
          </p>
        {/if}
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <!-- Health metrics -->
      <AgentHealthMetrics health={data.health} />

      <!-- View-only flow -->
      {#if flow}
        <section
          class={flowFullscreen
            ? 'surface-4 fixed inset-0 z-[var(--layer-modal)] flex flex-col'
            : 'surface-2 flex flex-col rounded-xl'}
        >
          <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p class="t-label">
              {m.autonomous_view_flow()}
            </p>
            <div class="flex items-center gap-1.5">
              <!-- ponytail: edit is a forward-hook — only DB-flow-backed agents have
                 dbFlowId; system agents render read-only code flows (no edit). -->
              {#if data.isAdmin && agent.dbFlowId}
                <Button variant="secondary" size="sm" href={`/flow-editor/${agent.dbFlowId}`}>
                  <Pencil size={13} />
                  {m.autonomous_edit_flow()}
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onclick={() => (flowFullscreen = !flowFullscreen)}
                aria-label={m.autonomous_maximize_flow()}
                title={m.autonomous_maximize_flow()}
              >
                {#if flowFullscreen}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
              </Button>
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
  </PageBody>
</PageShell>
