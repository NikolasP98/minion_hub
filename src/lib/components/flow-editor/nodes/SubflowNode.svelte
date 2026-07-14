<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { SubflowNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Workflow, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: SubflowNodeData } = $props();

  const flowLabel = $derived(data.flowName?.trim() || data.flowId || '');
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-pink)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-pink)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)] flex items-center justify-center shrink-0">
      <Workflow size={12} class="text-[var(--color-pink)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_subflow()}</span>
    <Button variant="ghost"
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_pickFlowToRun()}
      aria-label={m.flownode_pickFlowToRun()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </Button>
  </div>
  {#if flowLabel}
    <span class="inline-block text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-pink)_15%,transparent)] text-[var(--color-pink)] truncate max-w-[200px]">
      ↳ {flowLabel}
    </span>
  {:else}
    <p class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80">{m.flownode_doubleClickPickFlow()}</p>
  {/if}
</div>
