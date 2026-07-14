<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ChannelNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Send, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: ChannelNodeData } = $props();

  const destCount = $derived(Array.isArray(data.destinations) ? data.destinations.length : 0);
  const channelLabel = $derived(data.channel ? data.channel : 'no channel');
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)] flex items-center justify-center shrink-0">
      <Send size={12} class="text-[var(--color-cyan)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_channel()}</span>
    <Button variant="ghost"
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureDestinations()}
      aria-label={m.flownode_configureDestinations()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </Button>
  </div>
  <div class="flex items-center gap-1.5">
    <span class="text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-cyan)_15%,transparent)] text-[var(--color-cyan)] capitalize">
      {channelLabel}
    </span>
    <span class="text-[length:var(--font-size-telemetry)] text-muted">
      {destCount} {m.flownode_destination({ count: destCount })}
    </span>
  </div>
  {#if destCount === 0 || !data.channel}
    <p class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80 mt-1">{m.flownode_doubleClickPickChannelDestinations()}</p>
  {/if}
</div>
