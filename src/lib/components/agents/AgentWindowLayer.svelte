<script lang="ts">
  import { agentWindows } from '$lib/state/ui/agent-windows.svelte';
  import { DraggableDialog } from '$lib/components/ui';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import { getMasterFlow } from '$lib/flows/master-flows';
  import { BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
</script>

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
        <div class="flex h-full flex-col">
          {#if w.fullscreen}
            <div class="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[11px] text-white/50">
              <BookOpen size={12} /> {m.misc_masterFlowReadOnly()}
            </div>
          {/if}
          <div class="min-h-0 flex-1">
            <MasterFlowCanvas {flow} />
          </div>
        </div>
      {:else}
        <div class="grid h-full place-items-center text-sm text-white/40">{m.flow_masterFlowLabel()}</div>
      {/if}
    {/if}
  </DraggableDialog>
{/each}
