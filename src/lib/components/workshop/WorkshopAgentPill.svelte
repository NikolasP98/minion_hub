<script lang="ts">
  import * as tooltip from '@zag-js/tooltip';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';

  let { agent, onDragStart }: {
    agent: { id: string; name?: string; emoji?: string; description?: string };
    onDragStart: (e: DragEvent) => void;
  } = $props();

  const service = useMachine(tooltip.machine, () => ({
    id: `ws-pill-${agent.id}`,
    openDelay: 0,
    closeDelay: 0,
    positioning: { placement: 'bottom' as const, strategy: 'fixed' as const },
  }));

  const tip = $derived(tooltip.connect(service, normalizeProps));
</script>

<span {...tip.getTriggerProps() as Record<string, unknown>} class="contents">
  <button
    type="button"
    class="w-9 h-9 rounded-full border border-border bg-bg3 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-accent transition-colors overflow-hidden"
    draggable="true"
    ondragstart={onDragStart}
  >
    {#if agent.emoji}
      <span class="text-lg leading-none">{agent.emoji}</span>
    {:else}
      <img
        src={diceBearAvatarUrl(agent.name ?? agent.id)}
        alt={agent.name ?? agent.id}
        class="w-full h-full object-cover rounded-full"
        draggable="false"
      />
    {/if}
  </button>
</span>

{#if tip.open}
  <div {...tip.getPositionerProps()} style="position:fixed;z-index:9999;">
    <div
      {...tip.getContentProps()}
      class="bg-bg2 border border-border rounded px-2.5 py-1.5 shadow-lg whitespace-nowrap"
    >
      <div class="text-xs font-semibold text-foreground">{agent.name ?? agent.id}</div>
      {#if agent.description}
        <div class="text-[10px] text-muted mt-0.5 max-w-[200px] whitespace-normal">{agent.description}</div>
      {/if}
    </div>
  </div>
{/if}
