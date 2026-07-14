<script lang="ts">
  import {
    workshopState,
    addOutboxItem,
    markInboxItemRead,
    updateInboxItemStatus,
    type InboxItemStatus,
    type InboxAttachment,
  } from '$lib/state/workshop/workshop.svelte';
  import { sendInboxMessage } from '$lib/workshop/inbox-bridge';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import * as m from '$lib/paraglide/messages';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { Button, Select } from '$lib/components/ui';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  // --- State ---
  let activeTab = $state<'inbox' | 'outbox'>('inbox');
  let filterAgentId = $state('');
  let expandedItemId = $state<string | null>(null);
  let composeOpen = $state(false);
  let composeToId = $state('');
  let composeSubject = $state('');
  let composeContent = $state('');
  let composeFiles = $state<File[]>([]);
  let sending = $state(false);
  let dragOver = $state(false);

  // --- Derived ---
  let element = $derived(workshopState.elements[elementId]);
  let inboxItems = $derived(element?.inboxItems ?? []);
  let outboxItems = $derived(element?.outboxItems ?? []);
  let unreadCount = $derived(inboxItems.filter((m) => !m.read && m.status !== 'closed').length);

  let filteredItems = $derived.by(() => {
    const items = activeTab === 'inbox' ? inboxItems : outboxItems;
    if (!filterAgentId) return items;
    return items.filter((item) => item.fromId === filterAgentId || item.toId === filterAgentId);
  });

  // --- Helpers ---
  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return m.common_justNow();
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return m.common_minutesAgo({ count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return m.common_hoursAgo({ count: hours });
    const days = Math.floor(hours / 24);
    return m.common_daysAgo({ count: days });
  }

  function getAgentName(id: string): string {
    const agent = gw.agents.find((a) => a.id === id);
    return agent ? agentDisplayName(agent) : id;
  }

  function statusColor(status: InboxItemStatus): string {
    switch (status) {
      case 'open':
        return 'bg-accent';
      case 'pending':
        return 'bg-warning';
      case 'closed':
        return 'bg-muted';
      default:
        return 'bg-muted';
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function toggleRow(itemId: string) {
    if (expandedItemId === itemId) {
      expandedItemId = null;
    } else {
      expandedItemId = itemId;
      // Mark as read if inbox and unread
      if (activeTab === 'inbox') {
        const item = inboxItems.find((m) => m.id === itemId);
        if (item && !item.read) {
          markInboxItemRead(elementId, item.id);
        }
      }
    }
  }

  function handleStatusChange(itemId: string, newStatus: string) {
    updateInboxItemStatus(elementId, itemId, newStatus as InboxItemStatus);
  }

  // --- File handling ---
  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      composeFiles = [...composeFiles, ...Array.from(input.files)];
      input.value = '';
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.files) {
      composeFiles = [...composeFiles, ...Array.from(e.dataTransfer.files)];
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function removeFile(index: number) {
    composeFiles = composeFiles.filter((_, i) => i !== index);
  }

  // --- Send ---
  async function handleSend() {
    const trimmedContent = composeContent.trim();
    if (!trimmedContent || !composeToId || sending) return;

    sending = true;
    try {
      let attachments: InboxAttachment[] = [];

      if (composeFiles.length > 0) {
        for (const file of composeFiles) {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch('/api/files', {
            method: 'POST',
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            attachments.push({
              id: data.id,
              fileName: file.name,
              contentType: file.type || 'application/octet-stream',
              url: `/api/files/${data.id}`,
              sizeBytes: file.size,
            });
          }
        }
      }

      sendInboxMessage(
        element?.inboxAgentId ?? 'user',
        composeToId,
        trimmedContent,
        composeSubject.trim(),
        attachments,
      );

      composeToId = '';
      composeSubject = '';
      composeContent = '';
      composeFiles = [];
      composeOpen = false;
    } finally {
      sending = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-[var(--layer-modal)] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_40%,transparent)]"
  role="button"
  tabindex="-1"
  aria-label="Close"
  onclick={handleBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
>
  <div class="w-full max-w-lg rounded-lg border border-border bg-bg2 shadow-xl font-mono">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span class="text-xs text-foreground font-semibold">{m.inbox_title()}</span>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="rounded bg-accent/10 px-2 py-0.5 text-xs text-accent hover:bg-accent/20 transition-colors"
          onclick={() => (composeOpen = !composeOpen)}
        >
          {composeOpen ? m.common_cancel() : m.inbox_newMessage()}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={m.common_close()}
          class="text-xs text-muted hover:text-foreground"
          onclick={onClose}
        >
          x
        </Button>
      </div>
    </div>

    <!-- Agent filter -->
    <div class="border-b border-border px-4 py-1.5">
      <Select bind:value={filterAgentId} size="sm">
        <option value="">{m.inbox_allAgents()}</option>
        {#each gw.agents as agent (agent.id)}
          <option value={agent.id}>{agentDisplayName(agent)}</option>
        {/each}
      </Select>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-border">
      <Button
        variant="ghost"
        size="sm"
        class="flex-1 px-3 py-1.5 text-xs transition-colors {activeTab === 'inbox'
          ? 'text-accent border-b-2 border-accent'
          : 'text-muted hover:text-foreground'}"
        onclick={() => (activeTab = 'inbox')}
      >
        {m.inbox_inboxTab()}
        {#if unreadCount > 0}<span class="ml-1 text-accent">({unreadCount})</span>{/if}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="flex-1 px-3 py-1.5 text-xs transition-colors {activeTab === 'outbox'
          ? 'text-accent border-b-2 border-accent'
          : 'text-muted hover:text-foreground'}"
        onclick={() => (activeTab = 'outbox')}
      >
        {m.inbox_outboxTab()}
      </Button>
    </div>

    <!-- Message table -->
    <div class="max-h-75 overflow-y-auto">
      {#if filteredItems.length === 0}
        <div class="text-center text-xs text-muted py-6">
          {activeTab === 'inbox' ? m.inbox_noMessages() : m.inbox_noSentMessages()}
        </div>
      {:else}
        <!-- Table header -->
        <div
          class="sticky top-0 flex items-center gap-2 bg-bg2 border-b border-border px-3 py-1 text-xs text-muted"
        >
          <span class="w-3 shrink-0"></span>
          <span class="w-18 shrink-0">{m.inbox_colFrom()}</span>
          <span class="w-18 shrink-0">{m.inbox_colTo()}</span>
          <span class="flex-1 min-w-0">{m.inbox_colSubject()}</span>
          <span class="w-13 shrink-0 text-right">{m.inbox_colDate()}</span>
        </div>

        {#each filteredItems as item (item.id)}
          <!-- Row -->
          <Button
            variant="ghost"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left border-b border-border/50 hover:bg-bg3/50 transition-colors {!item.read &&
            activeTab === 'inbox'
              ? 'bg-accent/5'
              : ''}"
            onclick={() => toggleRow(item.id)}
          >
            <span class="w-3 shrink-0 flex items-center justify-center">
              <span class="inline-block h-2 w-2 rounded-full {statusColor(item.status)}"></span>
            </span>
            <span class="w-18 shrink-0 text-xs text-foreground truncate"
              >{getAgentName(item.fromId)}</span
            >
            <span class="w-18 shrink-0 text-xs text-foreground truncate"
              >{getAgentName(item.toId)}</span
            >
            <span
              class="flex-1 min-w-0 text-xs truncate {!item.read && activeTab === 'inbox'
                ? 'text-foreground font-semibold'
                : 'text-muted'}">{item.subject || m.inbox_noSubject()}</span
            >
            <span class="w-13 shrink-0 text-xs text-muted text-right"
              >{formatRelativeTime(item.sentAt)}</span
            >
          </Button>

          <!-- Expanded detail -->
          {#if expandedItemId === item.id}
            <div class="border-b border-border bg-bg3/30 px-4 py-2 space-y-2">
              <div class="text-xs text-foreground whitespace-pre-wrap wrap-break-word">
                {item.content}
              </div>

              {#if item.attachments && item.attachments.length > 0}
                <div class="space-y-0.5">
                  <span class="text-xs text-muted">{m.inbox_attachments()}</span>
                  {#each item.attachments as att (att.id)}
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block text-xs text-accent hover:underline truncate"
                    >
                      {att.fileName} ({(att.sizeBytes / 1024).toFixed(1)} KB)
                    </a>
                  {/each}
                </div>
              {/if}

              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{m.inbox_status()}</span>
                <Select
                  size="sm"
                  value={item.status}
                  onchange={(v) => handleStatusChange(item.id, String(v))}
                >
                  <option value="open">{m.inbox_statusOpen()}</option>
                  <option value="pending">{m.inbox_statusPending()}</option>
                  <option value="closed">{m.inbox_statusClosed()}</option>
                </Select>
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <!-- Compose panel -->
    {#if composeOpen}
      <div class="border-t border-border p-3 space-y-2">
        <div class="flex items-center gap-2">
          <label class="text-xs text-muted shrink-0" for="compose-to">{m.inbox_composeTo()}</label>
          <Select id="compose-to" fieldClass="min-w-0 flex-1" bind:value={composeToId} size="sm">
            <option value="" disabled>{m.inbox_selectAgent()}</option>
            {#each gw.agents as agent (agent.id)}
              <option value={agent.id}>{agentDisplayName(agent)}</option>
            {/each}
          </Select>
        </div>

        <div class="flex items-center gap-2">
          <label class="text-xs text-muted shrink-0" for="compose-subject"
            >{m.inbox_composeSubject()}</label
          >
          <input
            id="compose-subject"
            type="text"
            class="flex-1 rounded border border-border bg-bg3 px-2 py-1 text-xs text-foreground placeholder:text-muted outline-none focus:border-accent"
            placeholder={m.inbox_colSubject()}
            bind:value={composeSubject}
          />
        </div>

        <textarea
          class="w-full resize-none rounded border border-border bg-bg3 px-2 py-1 text-xs text-foreground placeholder:text-muted outline-none focus:border-accent"
          rows="2"
          placeholder={m.inbox_composePlaceholder()}
          bind:value={composeContent}></textarea>

        <!-- File upload zone -->
        <div
          class="rounded border border-dashed px-3 py-2 text-center text-xs transition-colors cursor-pointer {dragOver
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border text-muted hover:border-accent/50'}"
          role="button"
          tabindex="0"
          ondrop={handleDrop}
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          onclick={() => document.getElementById('compose-file-input')?.click()}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ')
              document.getElementById('compose-file-input')?.click();
          }}
        >
          {m.inbox_dropFiles()}
          <input
            id="compose-file-input"
            type="file"
            multiple
            class="hidden"
            onchange={handleFileInput}
          />
        </div>

        {#if composeFiles.length > 0}
          <div class="space-y-0.5">
            {#each composeFiles as file, i (file.name + '_' + i)}
              <div class="flex items-center justify-between text-xs text-foreground">
                <span class="truncate">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.common_remove()}
                  class="text-muted hover:text-foreground shrink-0 ml-2"
                  onclick={() => removeFile(i)}
                >
                  x
                </Button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            class="rounded bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
            onclick={handleSend}
            disabled={!composeContent.trim() || !composeToId || sending}
          >
            {sending ? m.inbox_sending() : m.chat_send()}
          </Button>
        </div>
      </div>
    {/if}
  </div>
</div>
