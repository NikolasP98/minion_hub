<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ReactionNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { SmilePlus, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: ReactionNodeData } = $props();
  const emoji = $derived((data.emoji ?? '').trim());
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
      <SmilePlus size={12} class="text-[var(--color-pink)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_setReaction()}</span>
    <Button variant="ghost"
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureReaction()}
      aria-label={m.flownode_configureReaction()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </Button>
  </div>
  <div class="flex items-center gap-1.5">
    {#if emoji}
      <span class="text-sm leading-none">{emoji}</span>
      <span class="text-[length:var(--font-size-telemetry)] text-muted">{m.flownode_onTriggerMessage()}</span>
    {:else}
      <span class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80">{m.flownode_doubleClickPickEmoji()}</span>
    {/if}
  </div>
</div>
