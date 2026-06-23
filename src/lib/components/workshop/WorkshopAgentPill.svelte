<script lang="ts">
  import { Tooltip } from '$lib/components/ui';
  import { agentDisplayName, agentAvatarUrl } from '$lib/utils/agent-display';

  let { agent, onDragStart, count }: {
    agent: { id: string; name?: string; emoji?: string; description?: string; identity?: { name?: string } | null };
    onDragStart: (e: DragEvent) => void;
    count?: number;
  } = $props();

  const displayName = $derived(agentDisplayName(agent));
</script>

<div class="relative shrink-0">
  <Tooltip id={`ws-pill-${agent.id}`} placement="bottom" openDelay={0}>
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
          src={agentAvatarUrl(agent.id)}
          alt={displayName}
          class="w-full h-full object-cover rounded-full"
          draggable="false"
        />
      {/if}
    </button>
    {#snippet content()}
      <div class="text-xs font-semibold text-foreground">{displayName}</div>
      {#if agent.description}
        <div class="text-[10px] text-muted mt-0.5 whitespace-normal">{agent.description}</div>
      {/if}
    {/snippet}
  </Tooltip>
  {#if count && count > 1}
    <span class="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent text-background text-[9px] font-bold flex items-center justify-center px-0.5 pointer-events-none leading-none">{count}</span>
  {/if}
</div>
