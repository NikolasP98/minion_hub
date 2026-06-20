<script lang="ts">
  import { agentWindows } from '$lib/state/ui/agent-windows.svelte';
  import { DraggableDialog } from '$lib/components/ui';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import FlowExports from '$lib/components/flow-editor/FlowExports.svelte';
  import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
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

<!-- Portaled to <body> so windows escape the app shell's z-10 stacking context
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
        <div class="flex h-full flex-col">
          {#if w.fullscreen}
            <div class="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[11px] text-white/50">
              <BookOpen size={12} /> {m.misc_masterFlowReadOnly()}
              {#if specs.length > 0}
                <div class="ml-auto">
                  <button
                    class={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] transition hover:bg-white/10 ${showExports[w.id] ? 'text-white' : 'text-white/50'}`}
                    onclick={() => toggleExports(w.id)}
                  >
                    <Share2 size={10} />
                    {m.flow_exports_badge({ n: specs.length })}
                  </button>
                </div>
              {/if}
            </div>
          {:else if specs.length > 0}
            <div class="flex shrink-0 justify-end px-2 py-1">
              <button
                class={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition hover:bg-white/10 ${showExports[w.id] ? 'text-white' : 'text-white/40'}`}
                onclick={() => toggleExports(w.id)}
              >
                <Share2 size={9} />
                {m.flow_exports_badge({ n: specs.length })}
              </button>
            </div>
          {/if}
          <div class="relative min-h-0 flex-1">
            <MasterFlowCanvas {flow} />
            {#if showExports[w.id] && specs.length > 0}
              <div class="absolute right-0 top-0 z-10 h-full overflow-y-auto border-l border-white/10 bg-[var(--color-surface,#111)]">
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
        <div class="grid h-full place-items-center text-sm text-white/40">{m.flow_masterFlowLabel()}</div>
      {/if}
    {/if}
  </DraggableDialog>
{/each}
</div>
