<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TriggerNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig, triggerSources } from '$lib/state/features/flow-editor.svelte';
  import { Zap, Settings2, Reply } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: TriggerNodeData } = $props();

  const EVENT_LABELS: Record<string, string> = {
    'message:received': m.flownode_messageReceived(),
    'message:sent': m.flownode_messageSent(),
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
  class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1.5">
    <div class="w-6 h-6 rounded-md bg-[var(--color-warning-surface)] flex items-center justify-center shrink-0">
      <Zap size={12} class="text-[var(--color-warning-fg)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{m.flownode_channelTrigger()}</span>
    <Button variant="ghost"
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureTrigger()}
      aria-label={m.flownode_configureTrigger()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </Button>
  </div>

  <div class="text-[length:var(--font-size-telemetry)] text-muted mb-1">{eventLabel}</div>

  {#if channelScoped}
    <div class="flex flex-wrap items-center gap-1">
      {#if selectedChannels.length === 0}
        <span class="text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)]">
          {m.flownode_allChannels()}
        </span>
      {:else}
        {#each selectedChannels as ch (ch)}
          <span class="text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] capitalize">
            {ch}
          </span>
        {/each}
      {/if}
    </div>
  {/if}

  {#if data.deliverResponse}
    <div class="flex items-center gap-1 mt-1.5 text-[length:var(--font-size-telemetry)] text-muted">
      <Reply size={10} class="text-[var(--color-warning-fg)]/80" /> {m.flownode_repliesToChannel()}
    </div>
  {/if}
</div>
