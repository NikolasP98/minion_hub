<script lang="ts">
  import { workshopState } from '$lib/state/workshop.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { slide } from 'svelte/transition';
  import type { WorkshopMessage } from '$lib/workshop/gateway-bridge';

  let { conversationId, messages: workshopMessages = [], onClose }: {
    conversationId: string;
    messages?: WorkshopMessage[];
    onClose: () => void;
  } = $props();

  let messagesEnd: HTMLDivElement | undefined = $state();

  let conversation = $derived(workshopState.conversations[conversationId]);

  let participants = $derived(
    (conversation?.participantInstanceIds ?? []).map((instanceId) => {
      const instance = workshopState.agents[instanceId];
      const agent = instance
        ? gw.agents.find((a) => a.id === instance.agentId)
        : undefined;
      return {
        instanceId,
        name: agent?.name ?? instance?.agentId ?? 'Unknown',
        emoji: agent?.emoji,
      };
    })
  );

  let participantNames = $derived(participants.map((p) => p.name).join(', '));

  let typeBadgeClass = $derived(
    conversation?.type === 'task'
      ? 'bg-accent/10 text-accent'
      : 'bg-purple-500/10 text-purple-400'
  );

  // Map workshop messages to display format
  let messages = $derived(
    workshopMessages.map((wm, idx) => {
      const inst = workshopState.agents[wm.instanceId];
      const agent = inst ? gw.agents.find((a: { id: string }) => a.id === inst.agentId) : undefined;
      return {
        id: `${wm.conversationId}_${idx}`,
        agentName: agent?.name ?? wm.agentId,
        emoji: agent?.emoji ?? '',
        text: wm.message,
        timestamp: wm.timestamp,
      };
    })
  );

  // Auto-scroll when messages change
  $effect(() => {
    // Access messages.length to create a dependency
    const _ = messages.length;
    if (messagesEnd) {
      messagesEnd.scrollIntoView({ behavior: 'smooth' });
    }
  });

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
</script>

<div
  class="chat-panel fixed right-0 top-0 h-full w-80 z-50 flex flex-col bg-bg2/95 backdrop-blur border-l border-border"
  transition:slide={{ axis: 'x', duration: 200 }}
>
  <!-- Header -->
  <div class="px-3 py-2 border-b border-border flex items-center justify-between gap-2 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      {#if conversation}
        <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 {typeBadgeClass}">
          {conversation.type}
        </span>
      {/if}
      <span class="text-[11px] text-foreground truncate">{participantNames}</span>
    </div>
    <button
      class="text-muted hover:text-foreground transition-colors shrink-0 p-0.5"
      onclick={onClose}
      aria-label="Close chat panel"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>

  <!-- Messages -->
  <div class="flex-1 px-3 py-2 space-y-3 overflow-y-auto">
    {#if messages.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2">
        {#if conversation?.status === 'active'}
          <span class="text-[11px] text-muted animate-pulse">Waiting for response...</span>
        {:else}
          <span class="text-[11px] text-muted">No messages yet</span>
        {/if}
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <div class="flex gap-2">
          <span class="text-base leading-none shrink-0 w-6 h-6 flex items-center justify-center">{msg.emoji || '•'}</span>
          <div class="min-w-0">
            <div class="flex items-baseline gap-1.5">
              <span class="text-[10px] font-mono text-muted">{msg.agentName}</span>
              <span class="text-[9px] text-muted/60">{formatRelativeTime(msg.timestamp)}</span>
            </div>
            <p class="text-[11px] text-foreground leading-snug mt-0.5">{msg.text}</p>
          </div>
        </div>
      {/each}
    {/if}
    <div bind:this={messagesEnd}></div>
  </div>
</div>
