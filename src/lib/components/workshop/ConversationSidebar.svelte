<script lang="ts">
  import { workshopState } from '$lib/state/workshop.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conversationMessages, conversationLoading } from '$lib/state/workshop-conversations.svelte';
  import { loadConversationHistory } from '$lib/workshop/gateway-bridge';
  import { slide } from 'svelte/transition';
  import { conn } from '$lib/state/connection.svelte';

  let {
    selectedConversationId = null,
    onSelectConversation,
    onClose,
  }: {
    selectedConversationId?: string | null;
    onSelectConversation: (id: string) => void;
    onClose: () => void;
  } = $props();

  let messagesEnd: HTMLDivElement | undefined = $state();

  // Sort conversations newest first
  let sortedConversations = $derived(
    Object.values(workshopState.conversations).sort(
      (a, b) => b.startedAt - a.startedAt,
    ),
  );

  let selectedConversation = $derived(
    selectedConversationId
      ? workshopState.conversations[selectedConversationId]
      : undefined,
  );

  let messages = $derived(
    selectedConversation
      ? (conversationMessages[selectedConversation.sessionKey] ?? [])
      : [],
  );

  let isLoading = $derived(
    selectedConversation
      ? (conversationLoading[selectedConversation.sessionKey] ?? false)
      : false,
  );

  // Auto-load history when a completed conversation is selected and has no messages
  $effect(() => {
    const conv = selectedConversation;
    if (!conv || conv.status === 'active') return;
    if (conversationMessages[conv.sessionKey]?.length) return;
    if (conversationLoading[conv.sessionKey]) return;
    if (!conn.connected) return;
    loadConversationHistory(conv);
  });

  // Auto-scroll when messages change
  $effect(() => {
    const _ = messages.length;
    if (messagesEnd) {
      messagesEnd.scrollIntoView({ behavior: 'smooth' });
    }
  });

  function resolveAgent(agentId: string | undefined) {
    if (!agentId) return { name: 'Unknown', emoji: '' };
    const agent = gw.agents.find((a: { id: string }) => a.id === agentId);
    return {
      name: agent?.name ?? agentId,
      emoji: (agent as { emoji?: string } | undefined)?.emoji ?? '',
    };
  }

  function getParticipantNames(conv: (typeof sortedConversations)[0]): string {
    return conv.participantAgentIds
      .map((id) => resolveAgent(id).name)
      .join(', ');
  }

  function getParticipantEmojis(conv: (typeof sortedConversations)[0]): string {
    return conv.participantAgentIds
      .map((id) => resolveAgent(id).emoji)
      .filter(Boolean)
      .join('');
  }

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  async function handleLoadHistory() {
    if (!selectedConversation) return;
    await loadConversationHistory(selectedConversation);
  }
</script>

<div
  class="conversation-sidebar absolute right-0 top-0 h-full w-[420px] z-50 flex bg-bg2/95 backdrop-blur border-l border-border"
  transition:slide={{ axis: 'x', duration: 200 }}
>
  <!-- Conversation list (left section) -->
  <div class="w-[140px] shrink-0 flex flex-col border-r border-border">
    <div class="px-2 py-2 border-b border-border flex items-center justify-between">
      <span class="text-[9px] font-mono uppercase text-muted tracking-wider">Conversations</span>
    </div>
    <div class="flex-1 overflow-y-auto">
      {#if sortedConversations.length === 0}
        <div class="px-2 py-4 text-center">
          <span class="text-[9px] text-muted">No conversations</span>
        </div>
      {:else}
        {#each sortedConversations as conv (conv.id)}
          <button
            class="w-full text-left px-2 py-1.5 border-b border-border/50 hover:bg-accent/5 transition-colors
              {selectedConversationId === conv.id ? 'bg-accent/10' : ''}
              {conv.status === 'completed' ? 'opacity-60' : ''}"
            onclick={() => onSelectConversation(conv.id)}
          >
            <div class="flex items-center gap-1">
              {#if conv.status === 'active'}
                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0"></span>
              {:else if conv.status === 'queued'}
                <span class="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"></span>
              {:else}
                <span class="w-1.5 h-1.5 rounded-full bg-muted/40 shrink-0"></span>
              {/if}
              <span class="text-[9px] font-mono uppercase px-1 py-0.5 rounded
                {conv.type === 'task' ? 'bg-accent/10 text-accent' : 'bg-purple-500/10 text-purple-400'}">
                {conv.type}
              </span>
            </div>
            <div class="mt-0.5 text-[10px] text-foreground truncate leading-tight">
              {getParticipantEmojis(conv)} {getParticipantNames(conv)}
            </div>
            <div class="text-[9px] text-muted/60 mt-0.5">
              {formatRelativeTime(conv.startedAt)}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Message viewer (right section) -->
  <div class="flex-1 flex flex-col min-w-0">
    <!-- Header -->
    <div class="px-3 py-2 border-b border-border flex items-center justify-between gap-2 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        {#if selectedConversation}
          <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0
            {selectedConversation.type === 'task' ? 'bg-accent/10 text-accent' : 'bg-purple-500/10 text-purple-400'}">
            {selectedConversation.type}
          </span>
          <span class="text-[11px] text-foreground truncate">
            {getParticipantNames(selectedConversation)}
          </span>
          {#if selectedConversation.status === 'active'}
            <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0"></span>
          {/if}
        {:else}
          <span class="text-[11px] text-muted">Select a conversation</span>
        {/if}
      </div>
      <button
        class="text-muted hover:text-foreground transition-colors shrink-0 p-0.5"
        onclick={onClose}
        aria-label="Close conversation sidebar"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Messages area -->
    <div class="flex-1 px-3 py-2 space-y-3 overflow-y-auto">
      {#if !selectedConversation}
        <div class="flex flex-col items-center justify-center h-full gap-2">
          <span class="text-[11px] text-muted">Pick a conversation from the list</span>
        </div>
      {:else if isLoading}
        <div class="flex flex-col items-center justify-center h-full gap-2">
          <span class="text-[11px] text-muted animate-pulse">Loading messages...</span>
        </div>
      {:else if messages.length === 0}
        <div class="flex flex-col items-center justify-center h-full gap-2">
          {#if selectedConversation.status === 'active'}
            <span class="text-[11px] text-muted animate-pulse">Waiting for response...</span>
          {:else if selectedConversation.status === 'completed' && conn.connected}
            <span class="text-[11px] text-muted mb-2">No cached messages</span>
            <button
              class="text-[10px] font-mono px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              onclick={handleLoadHistory}
            >
              Load history
            </button>
          {:else}
            <span class="text-[11px] text-muted">No messages</span>
          {/if}
        </div>
      {:else}
        {#each messages as msg, idx (idx)}
          {@const agent = resolveAgent(msg.agentId)}
          <div class="flex gap-2">
            <span class="text-base leading-none shrink-0 w-6 h-6 flex items-center justify-center">
              {agent.emoji || '\u2022'}
            </span>
            <div class="min-w-0">
              <div class="flex items-baseline gap-1.5">
                <span class="text-[10px] font-mono text-muted">{agent.name}</span>
                <span class="text-[9px] text-muted/60">{formatRelativeTime(msg.timestamp)}</span>
              </div>
              <p class="text-[11px] text-foreground leading-snug mt-0.5 whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          </div>
        {/each}
      {/if}
      <div bind:this={messagesEnd}></div>
    </div>
  </div>
</div>
