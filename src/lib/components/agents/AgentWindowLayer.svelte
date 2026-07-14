<script lang="ts">
  import { agentWindows } from '$lib/state/ui/agent-windows.svelte';
  import { DraggableDialog, Button } from '$lib/components/ui';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import FlowExports from '$lib/components/flow-editor/FlowExports.svelte';
  import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
  import { flowVariableSchema } from '$lib/flows/flow-variables';
  import { BookOpen, Share2 } from 'lucide-svelte';
  import { portal } from '$lib/actions/portal';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';

  // Local per-window exports-panel visibility. Keyed by window id.
  let showExports = $state<Record<string, boolean>>({});

  function toggleExports(windowId: string) {
    showExports = { ...showExports, [windowId]: !showExports[windowId] };
  }

  // Read flowTogglesByFlow and isAdmin from page.data (populated by the load functions).
  const flowTogglesByFlow = $derived(
    (page.data as { flowTogglesByFlow?: Record<string, Record<string, boolean>> }).flowTogglesByFlow ?? {},
  );
  const isAdmin = $derived(
    (page.data as { isAdmin?: boolean }).isAdmin ?? false,
  );
</script>

<!-- Portaled to <body> so windows escape the app shell's z-[var(--layer-sticky)] stacking context
     and can render above the sidebar / topbar / assistant pill (esp. fullscreen). -->
<div use:portal>
{#each agentWindows.windows as w (w.id)}
  <DraggableDialog
    title={w.title}
    z={w.z}
    fullscreen={w.fullscreen}
    x={w.x}
    y={w.y}
    onfocus={() => agentWindows.focus(w.id)}
    onclose={() => agentWindows.close(w.id)}
    ontogglefullscreen={() => agentWindows.toggleFullscreen(w.id)}
    onmove={(x, y) => agentWindows.setPosition(w.id, x, y)}
  >
    {#if w.kind === 'artifact' && w.artifact}
      <ArtifactHost descriptor={w.artifact} chrome={false} />
    {:else if w.kind === 'flow' && w.flowId}
      {@const flow = getMasterFlow(w.flowId)}
      {#if flow}
        {@const specs = flowExportedSpecs(flow)}
        {@const enabledCount = flowVariableSchema(specs, flowTogglesByFlow[w.flowId] ?? {}).length}
        <div class="flex h-full flex-col">
          {#if w.fullscreen}
            <div class="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-default)] px-3 py-1.5 text-[length:var(--font-size-caption)] text-[var(--color-text-primary)]/50">
              <BookOpen size={12} /> {m.misc_masterFlowReadOnly()}
              {#if specs.length > 0}
                <div class="ml-auto">
                  <Button variant="ghost"
                    class={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[length:var(--font-size-caption)] transition hover:bg-[var(--color-text-primary)]/10 ${showExports[w.id] ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)]/50'}`}
                    onclick={() => toggleExports(w.id)}
                  >
                    <Share2 size={10} />
                    {m.flow_exports_badge({ n: enabledCount })}
                  </Button>
                </div>
              {/if}
            </div>
          {:else if specs.length > 0}
            <div class="flex shrink-0 justify-end px-2 py-1">
              <Button variant="ghost"
                class={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[length:var(--font-size-telemetry)] transition hover:bg-[var(--color-text-primary)]/10 ${showExports[w.id] ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)]/40'}`}
                onclick={() => toggleExports(w.id)}
              >
                <Share2 size={9} />
                {m.flow_exports_badge({ n: enabledCount })}
              </Button>
            </div>
          {/if}
          <div class="relative min-h-0 flex-1">
            <MasterFlowCanvas {flow} />
            {#if showExports[w.id] && specs.length > 0}
              <div class="absolute right-0 top-0 z-[var(--layer-sticky)] h-full overflow-y-auto border-l border-[var(--color-border-default)] bg-[var(--color-surface-1)]">
                <FlowExports
                  flowId={w.flowId}
                  {specs}
                  toggles={flowTogglesByFlow[w.flowId] ?? {}}
                  canEdit={isAdmin}
                />
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="grid h-full place-items-center text-sm text-[var(--color-text-primary)]/40">{m.flow_masterFlowLabel()}</div>
      {/if}
    {/if}
  </DraggableDialog>
{/each}
</div>
