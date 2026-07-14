<script lang="ts">
  /**
   * HTML overlay layer that renders above the PixiJS canvas:
   *   - Speech bubbles
   *   - Conversation indicators between agent pairs
   *   - Thinking/typing indicators
   *
   * This is pure DOM markup — NOT on the Pixi ticker / Rapier physics hot
   * path. The render loop in the parent component never reaches into this
   * sub-tree.
   */
  import SpeechBubble from '../SpeechBubble.svelte';
  import ConversationIndicator from '../ConversationIndicator.svelte';
  import AgentActionBar from '../AgentActionBar.svelte';
  import { workshopState } from '$lib/state/workshop/workshop.svelte';
  import { thinkingAgents } from '$lib/state/workshop/workshop-conversations.svelte';
  import { getAgentState, type AgentFsmState } from '$lib/workshop/agent-fsm';
  import type { SpeechBubbleEntry } from './types';

  // Per-agent status glyph: a dot anchored to the sprite so you can scan who's
  // doing what without opening the conversations sidebar. Only *noteworthy*
  // states get a dot — idle / wandering / patrolling / dragged show nothing, so
  // the canvas stays calm and activity pops.
  const STATUS_GLYPHS: Partial<
    Record<AgentFsmState, { cls: string; pulse: boolean; label: string }>
  > = {
    conversing: { cls: 'bg-[var(--color-warning-surface)]', pulse: true, label: 'In conversation' },
    reading: { cls: 'bg-[var(--color-info-surface)]', pulse: false, label: 'Reading' },
    cooldown: { cls: 'bg-foreground/30', pulse: false, label: 'Cooling down' },
    heartbeat: {
      cls: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]',
      pulse: true,
      label: 'Waking up',
    },
  };

  interface Props {
    speechBubbles: SpeechBubbleEntry[];
    worldToScreenAware: (
      worldX: number,
      worldY: number,
    ) => {
      x: number;
      y: number;
    };
    onRemoveBubble: (id: string) => void;
    onOpenConversation: (conversationId: string) => void;
    selectedInstanceId?: string | null;
    connected?: boolean;
    onAgentChat?: () => void;
    onAgentTask?: () => void;
    onAgentBehavior?: () => void;
    onAgentDelete?: () => void;
  }

  let {
    speechBubbles,
    worldToScreenAware,
    onRemoveBubble,
    onOpenConversation,
    selectedInstanceId = null,
    connected = false,
    onAgentChat,
    onAgentTask,
    onAgentBehavior,
    onAgentDelete,
  }: Props = $props();
</script>

<div class="absolute inset-0 pointer-events-none overflow-hidden z-[var(--layer-navigation)]">
  {#each speechBubbles as bubble (bubble.id)}
    {@const agent = workshopState.agents[bubble.instanceId]}
    {#if agent}
      {@const screenPos = worldToScreenAware(agent.position.x, agent.position.y)}
      <SpeechBubble
        message={bubble.message}
        agentName={bubble.agentName}
        screenX={screenPos.x}
        screenY={screenPos.y}
        onFaded={() => onRemoveBubble(bubble.id)}
      />
    {/if}
  {/each}

  <!-- Conversation indicators between agent pairs -->
  {#each Object.values(workshopState.conversations).filter((c) => c.status === 'active') as conv (conv.id)}
    {#if conv.participantInstanceIds.length >= 2}
      {@const instA = workshopState.agents[conv.participantInstanceIds[0]]}
      {@const instB = workshopState.agents[conv.participantInstanceIds[1]]}
      {#if instA && instB}
        {@const midWorldX = (instA.position.x + instB.position.x) / 2}
        {@const midWorldY = Math.min(instA.position.y, instB.position.y) - 30}
        {@const screenPos = worldToScreenAware(midWorldX, midWorldY)}
        <ConversationIndicator
          x={screenPos.x}
          y={screenPos.y}
          type={conv.type}
          onclick={() => onOpenConversation(conv.id)}
        />
      {/if}
    {/if}
  {/each}

  <!-- Per-agent status glyphs (conversing / reading / cooldown / heartbeat) -->
  {#each Object.values(workshopState.agents) as agent (agent.instanceId)}
    {@const glyph = STATUS_GLYPHS[getAgentState(agent.instanceId) ?? 'idle']}
    {#if glyph}
      {@const gp = worldToScreenAware(agent.position.x, agent.position.y)}
      <div
        class="absolute pointer-events-none z-[var(--layer-navigation)]"
        style="left: {gp.x + 13}px; top: {gp.y + 11}px;"
        title={glyph.label}
        aria-label={glyph.label}
      >
        <span
          class="block w-2 h-2 rounded-full ring-1 ring-bg2/80 {glyph.cls} {glyph.pulse
            ? 'status-glyph-pulse'
            : ''}"
        ></span>
      </div>
    {/if}
  {/each}

  <!-- Thinking/typing indicators -->
  {#each Object.keys(thinkingAgents) as instanceId (instanceId)}
    {@const agent = workshopState.agents[instanceId]}
    {#if agent}
      {@const pos = worldToScreenAware(agent.position.x, agent.position.y)}
      <div
        class="absolute pointer-events-none z-[var(--layer-navigation)] thinking-indicator"
        style="left: {pos.x}px; top: {pos.y - 55}px; transform: translateX(-50%);"
      >
        <div
          class="flex items-center gap-0.5 px-2 py-1 rounded-full bg-bg2/80 backdrop-blur border border-border/50"
        >
          <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"></span>
          <span
            class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
            style="animation-delay: 0.2s"
          ></span>
          <span
            class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
            style="animation-delay: 0.4s"
          ></span>
        </div>
      </div>
    {/if}
  {/each}

  <!-- Selected-agent floating action bar -->
  {#if selectedInstanceId}
    {@const sel = workshopState.agents[selectedInstanceId]}
    {#if sel}
      {@const sp = worldToScreenAware(sel.position.x, sel.position.y)}
      <AgentActionBar
        screenX={sp.x}
        screenY={sp.y}
        {connected}
        behavior={sel.behavior}
        onChat={() => onAgentChat?.()}
        onTask={() => onAgentTask?.()}
        onBehavior={() => onAgentBehavior?.()}
        onDelete={() => onAgentDelete?.()}
      />
    {/if}
  {/if}
</div>

<style>
  .thinking-dot {
    animation: thinking-bounce 1.4s infinite ease-in-out;
  }

  .status-glyph-pulse {
    animation: status-glyph-pulse 1.2s infinite ease-in-out;
  }

  @keyframes status-glyph-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.25);
    }
  }

  @keyframes thinking-bounce {
    0%,
    80%,
    100% {
      opacity: 0.25;
      transform: scale(0.8);
    }
    40% {
      opacity: 1;
      transform: scale(1.2);
    }
  }
</style>
