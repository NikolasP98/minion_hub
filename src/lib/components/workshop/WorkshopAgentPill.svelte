<script lang="ts">
  import { Button, Tooltip } from '$lib/components/ui';
  import { agentDisplayName, agentAvatarUrl } from '$lib/utils/agent-display';
  import * as m from '$lib/paraglide/messages';

  let {
    agent,
    onDragStart,
    onAdd,
    count,
  }: {
    agent: {
      id: string;
      name?: string;
      emoji?: string;
      description?: string;
      identity?: { name?: string } | null;
    };
    onDragStart: (e: DragEvent) => void;
    /** Activation of the pill; the palette acts on it only when it came from the keyboard. */
    onAdd?: (e: MouseEvent, name: string) => void;
    count?: number;
  } = $props();

  const displayName = $derived(agentDisplayName(agent));
</script>

<div class="relative shrink-0">
  <Tooltip id={`ws-pill-${agent.id}`} placement="bottom" openDelay={0}>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="w-9 h-[var(--control-height-lg)] rounded-full border border-border bg-bg3 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-accent transition-colors overflow-hidden"
      draggable="true"
      ondragstart={onDragStart}
      onclick={(e: MouseEvent) => onAdd?.(e, displayName)}
      aria-label={m.workshop_kbAddToCanvas({ name: displayName })}
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
    </Button>
    {#snippet content()}
      <div class="text-xs font-semibold text-foreground">{displayName}</div>
      {#if agent.description}
        <div class="text-xs text-muted mt-0.5 whitespace-normal">{agent.description}</div>
      {/if}
    {/snippet}
  </Tooltip>
  {#if count && count > 1}
    <span
      class="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent text-background text-xs font-bold flex items-center justify-center px-0.5 pointer-events-none leading-none"
      >{count}</span
    >
  {/if}
</div>
