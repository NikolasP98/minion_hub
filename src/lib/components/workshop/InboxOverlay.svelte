<script lang="ts">
  import {
    workshopState,
    addOutboxItem,
    markInboxItemRead,
  } from '$lib/state/workshop.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let activeTab = $state<'inbox' | 'outbox'>('inbox');
  let composeToId = $state('');
  let composeContent = $state('');

  let element = $derived(workshopState.elements[elementId]);
  let inboxItems = $derived(element?.inboxItems ?? []);
  let outboxItems = $derived(element?.outboxItems ?? []);
  let unreadCount = $derived(inboxItems.filter((m) => !m.read).length);

  function handleSend() {
    const trimmedContent = composeContent.trim();
    if (!trimmedContent || !composeToId) return;
    addOutboxItem(elementId, {
      fromId: 'user',
      toId: composeToId,
      content: trimmedContent,
      sentAt: Date.now(),
      read: false,
    });
    composeContent = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span class="text-[10px] font-mono text-foreground font-semibold">Inbox / Outbox</span>
      <button
        class="text-[10px] font-mono text-muted hover:text-foreground"
        onclick={onClose}
      >
        x
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-border">
      <button
        class="flex-1 px-3 py-1.5 text-[10px] font-mono transition-colors {activeTab === 'inbox'
          ? 'text-accent border-b-2 border-accent'
          : 'text-muted hover:text-foreground'}"
        onclick={() => (activeTab = 'inbox')}
      >
        Inbox {#if unreadCount > 0}<span class="ml-1 text-accent">({unreadCount})</span>{/if}
      </button>
      <button
        class="flex-1 px-3 py-1.5 text-[10px] font-mono transition-colors {activeTab === 'outbox'
          ? 'text-accent border-b-2 border-accent'
          : 'text-muted hover:text-foreground'}"
        onclick={() => (activeTab = 'outbox')}
      >
        Outbox
      </button>
    </div>

    <!-- Message list -->
    <div class="max-h-[250px] overflow-y-auto p-3 space-y-2">
      {#if activeTab === 'inbox'}
        {#each inboxItems as item (item.id)}
          <button
            class="w-full text-left rounded border p-2 transition-colors {item.read
              ? 'border-border bg-bg3'
              : 'border-accent/30 bg-accent/5'}"
            onclick={() => {
              if (!item.read) markInboxItemRead(elementId, item.id);
            }}
          >
            <div class="flex items-center gap-1">
              <span class="text-[9px] font-mono text-muted">from {item.fromId}</span>
              {#if !item.read}
                <span class="inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
              {/if}
            </div>
            <div class="mt-0.5 text-[10px] font-mono text-foreground break-words">{item.content}</div>
            <div class="mt-1 text-[9px] font-mono text-muted">{formatRelativeTime(item.sentAt)}</div>
          </button>
        {:else}
          <div class="text-center text-[10px] font-mono text-muted py-4">No messages</div>
        {/each}
      {:else}
        {#each outboxItems as item (item.id)}
          <div class="rounded border border-border bg-bg3 p-2">
            <div class="text-[9px] font-mono text-muted">to {item.toId}</div>
            <div class="mt-0.5 text-[10px] font-mono text-foreground break-words">{item.content}</div>
            <div class="mt-1 text-[9px] font-mono text-muted">{formatRelativeTime(item.sentAt)}</div>
          </div>
        {:else}
          <div class="text-center text-[10px] font-mono text-muted py-4">No sent messages</div>
        {/each}
      {/if}
    </div>

    <!-- Compose -->
    <div class="border-t border-border p-3 space-y-2">
      <div class="flex items-center gap-2">
        <label class="text-[9px] font-mono text-muted shrink-0" for="inbox-target">To:</label>
        <select
          id="inbox-target"
          class="flex-1 rounded border border-border bg-bg3 px-2 py-1 text-[10px] font-mono text-foreground outline-none focus:border-accent"
          bind:value={composeToId}
        >
          <option value="" disabled>Select agent</option>
          {#each gw.agents as agent (agent.id)}
            <option value={agent.id}>{agent.name ?? agent.id}</option>
          {/each}
        </select>
      </div>
      <div class="flex items-end gap-2">
        <textarea
          class="flex-1 resize-none rounded border border-border bg-bg3 px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
          rows="2"
          placeholder="Write a message..."
          bind:value={composeContent}
          onkeydown={handleKeydown}
        ></textarea>
        <button
          class="shrink-0 rounded bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent hover:bg-accent/20 disabled:opacity-40"
          onclick={handleSend}
          disabled={!composeContent.trim() || !composeToId}
        >
          Send
        </button>
      </div>
    </div>
  </div>
</div>
