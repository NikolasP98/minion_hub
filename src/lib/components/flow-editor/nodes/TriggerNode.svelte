<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TriggerNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig, triggerSources } from '$lib/state/features/flow-editor.svelte';
  import { Zap, Settings2, Reply } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: TriggerNodeData } = $props();

  const EVENT_LABELS: Record<string, string> = {
    'message:received': 'Message received',
    'message:sent': 'Message sent',
  };

  const sources = $derived(triggerSources(data));
  const selectedChannels = $derived([...new Set(sources.map((s) => s.channel).filter(Boolean))]);
  const eventLabel = $derived(EVENT_LABELS[data.event] ?? data.event);
  const channelScoped = true;
</script>

<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1.5">
    <div class="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center shrink-0">
      <Zap size={12} class="text-amber-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">Channel Trigger</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title="Configure trigger"
      aria-label="Configure trigger"
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>

  <div class="text-[10px] text-muted mb-1">{eventLabel}</div>

  {#if channelScoped}
    <div class="flex flex-wrap items-center gap-1">
      {#if selectedChannels.length === 0}
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
          All channels
        </span>
      {:else}
        {#each selectedChannels as ch (ch)}
          <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 capitalize">
            {ch}
          </span>
        {/each}
      {/if}
    </div>
  {/if}

  {#if data.deliverResponse}
    <div class="flex items-center gap-1 mt-1.5 text-[10px] text-muted">
      <Reply size={10} class="text-amber-400/80" /> Replies to channel
    </div>
  {/if}
</div>
