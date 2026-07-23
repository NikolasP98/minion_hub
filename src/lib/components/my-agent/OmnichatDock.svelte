<script lang="ts" module>
  import type { RecentConversation } from '$server/services/messages.service';
  import {
    LatestThreadRequests,
    type OmnichatThreadMessage as CachedThreadMessage,
  } from './omnichat-thread-cache';

  // Module-level caches survive unmount/remount (collapse, nav away and back),
  // so the dock paints instantly instead of repopulating on every mount.
  let convosCache: RecentConversation[] = [];
  let convosLoaded = false;
  let convosHasMore = true;
  const threadCache = new Map<string, CachedThreadMessage[]>();
  const threadRequests = new LatestThreadRequests();
  const threadKey = (c: RecentConversation) => `${c.channel}:${c.chatId}`;
  const PAGE = 25;
</script>

<script lang="ts">
  import { Button, EmptyState, Spinner, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import {
    MessagesSquare,
    GripVertical,
    PanelRightClose,
    Users,
    ChevronLeft,
    SendHorizontal,
    Paperclip,
  } from 'lucide-svelte';
  import { notesState, togglePanel } from '$lib/state/features/agent-notes.svelte';
  import { setDragContext } from '$lib/utils/drag-context';
  import { fmtTimeAgo } from '$lib/utils/format';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import {
    mergeServerThread,
    settleOptimisticMessage,
    type OmnichatThreadMessage,
  } from './omnichat-thread-cache';

  interface Props {
    /** Render as the slim collapsed rail (used when the panel is collapsed). */
    rail?: boolean;
  }
  const { rail = false }: Props = $props();

  let convos = $state<RecentConversation[]>(convosCache);
  let loaded = $state(convosLoaded);
  let hasMore = $state(convosHasMore);
  let loadingMore = $state(false);

  // ─── Channel filter (header icons) ───
  // 1 channel: inert gray indicator. 2 channels: single-select (gray pair =
  // "all", clicking the active one returns to all). 3+: classic multi-toggle,
  // empty selection = all.
  const channels = $derived([...new Set(convos.map((c) => c.channel))].sort());
  let chanSel = $state<string[]>([]);
  const effectiveSel = $derived(chanSel.filter((s) => channels.includes(s)));
  const visible = $derived(
    effectiveSel.length === 0 ? convos : convos.filter((c) => effectiveSel.includes(c.channel)),
  );
  function clickChannel(ch: string) {
    if (channels.length < 2) return;
    if (channels.length === 2) {
      chanSel = chanSel.includes(ch) ? [] : [ch];
    } else {
      chanSel = chanSel.includes(ch) ? chanSel.filter((s) => s !== ch) : [...chanSel, ch];
    }
  }

  // ─── Thread view ───
  let selected = $state<RecentConversation | null>(null);
  let thread = $state<OmnichatThreadMessage[]>([]);
  let threadLoading = $state(false);
  let draft = $state('');
  let sendSeq = 0;
  let threadEl = $state<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/messages?view=conversations&limit=${PAGE}`);
      if (!res.ok) return;
      const page = ((await res.json()).conversations ?? []) as RecentConversation[];
      // Replace the first page, keep any load-more tail (deduped — a thread that
      // moved up into page 1 is dropped from the tail).
      const tail = convos
        .slice(PAGE)
        .filter((c) => !page.some((p) => threadKey(p) === threadKey(c)));
      convos = [...page, ...tail];
      loaded = true;
      if (tail.length === 0) hasMore = page.length === PAGE;
      convosCache = convos;
      convosLoaded = true;
      convosHasMore = hasMore;
    } catch {
      /* transient — next poll retries */
    }
  }

  async function loadMore() {
    if (loadingMore) return;
    loadingMore = true;
    try {
      const res = await fetch(
        `/api/messages?view=conversations&limit=${PAGE}&offset=${convos.length}`,
      );
      if (!res.ok) return;
      const page = ((await res.json()).conversations ?? []) as RecentConversation[];
      const fresh = page.filter((p) => !convos.some((c) => threadKey(c) === threadKey(p)));
      convos = [...convos, ...fresh];
      hasMore = page.length === PAGE;
      convosCache = convos;
      convosHasMore = hasMore;
    } catch {
      /* transient */
    } finally {
      loadingMore = false;
    }
  }

  async function refreshThread(c: RecentConversation) {
    const key = threadKey(c);
    const requestId = threadRequests.begin(key);
    try {
      const q = new URLSearchParams({
        view: 'thread',
        channel: c.channel,
        chatId: c.chatId,
        limit: '60',
      });
      const res = await fetch(`/api/messages?${q}`);
      if (!res.ok) return;
      const rows = ((await res.json()).messages ?? []) as OmnichatThreadMessage[];
      const asc = rows.slice().reverse();
      if (!threadRequests.isLatest(key, requestId)) return;

      // Merge against this conversation's cache, never whichever thread happens
      // to be visible after navigation while the request was in flight.
      const merged = mergeServerThread(asc, threadCache.get(key) ?? []);
      threadCache.set(key, merged);
      if (selected && threadKey(selected) === key) {
        thread = merged;
      }
    } catch {
      /* transient — next poll retries */
    } finally {
      // An older request must not clear the spinner for a newer request, and a
      // response for the previous conversation must not clear the current one.
      if (threadRequests.finish(key, requestId) && selected && threadKey(selected) === key) {
        threadLoading = false;
      }
    }
  }

  function openThread(c: RecentConversation) {
    selected = c;
    thread = threadCache.get(threadKey(c)) ?? [];
    threadLoading = thread.length === 0;
    void refreshThread(c);
  }

  function backToList() {
    selected = null;
    draft = '';
  }

  async function sendReply() {
    const c = selected;
    const text = draft.trim();
    if (!c || !text) return;
    const key = threadKey(c);
    const clientId = `omni-send:${c.chatId}:${Date.now()}-${sendSeq++}`;
    const bubble: OmnichatThreadMessage = {
      clientId,
      direction: 'outbound',
      content: text,
      senderName: null,
      occurredAt: new Date().toISOString(),
      pending: true,
    };
    const optimistic = [...(threadCache.get(key) ?? thread), bubble];
    threadCache.set(key, optimistic);
    thread = optimistic;
    draft = '';
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: c.channel, chatId: c.chatId, text, clientId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const settled = settleOptimisticMessage(threadCache.get(key) ?? optimistic, clientId, false);
      threadCache.set(key, settled);
      if (selected && threadKey(selected) === key) thread = settled;
      void refresh();
    } catch {
      const settled = settleOptimisticMessage(threadCache.get(key) ?? optimistic, clientId, true);
      threadCache.set(key, settled);
      if (selected && threadKey(selected) === key) thread = settled;
    }
  }

  // List poll (60s) on the list view; thread poll (15s) while a conversation is
  // open. ponytail: polling — no WS push exists for ledger messages.
  $effect(() => {
    if (rail || !notesState.open) return;
    if (selected) {
      const c = selected;
      const id = setInterval(() => void refreshThread(c), 15_000);
      return () => clearInterval(id);
    }
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  });

  // Pin the thread scroll to the newest message.
  $effect(() => {
    void thread.length;
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  });

  function displayName(c: RecentConversation): string {
    return c.senderName || c.senderHandle || c.chatId;
  }

  // Draggable context payload: dropping a chat on the ChatInput folds this
  // block into the prompt (same contract as notes/events/emails).
  function chatDragStart(e: DragEvent, c: RecentConversation) {
    const name = displayName(c);
    const when = c.occurredAt ? new Date(c.occurredAt).toISOString() : '?';
    setDragContext(e, {
      kind: 'chat',
      label: `${name} · ${c.channel}`,
      text: [
        `Conversation on ${c.channel} with ${name}${c.isGroup ? ' (group)' : ''}`,
        `chat id: ${c.chatId}`,
        `last message (${c.direction === 'outbound' ? 'sent' : 'received'} ${when}): ${c.content ?? ''}`,
      ].join('\n'),
    });
  }
</script>

{#if rail}
  <aside class="omni-panel collapsed" aria-label={m.omni_ariaLabel()}>
    <Button type="button" class="omni-rail" onclick={togglePanel} aria-label={m.omni_openPanel()}>
      <span class="rail-icon"><MessagesSquare size={iconSizes.md} /></span>
      <span class="rail-label">{m.omni_panelTitle()}</span>
    </Button>
  </aside>
{:else}
  <aside class="omni-panel" aria-label={m.omni_ariaLabel()}>
    <header class="panel-head">
      {#if selected}
        <div class="head-title thread-head">
          <Button type="button" class="back-btn" aria-label={m.common_back()} onclick={backToList}>
            <ChevronLeft size={iconSizes.md} />
          </Button>
          <span class="thread-name">{displayName(selected)}</span>
          <span class="row-chan" title={selected.channel}>
            <ChannelBrandIcon channel={selected.channel} size={iconSizes.sm} />
          </span>
        </div>
      {:else}
        <div class="head-title">
          <MessagesSquare size={iconSizes.md} />
          <span>{m.omni_panelTitle()}</span>
        </div>
        {#if channels.length > 0}
          <div class="chan-filter">
            {#each channels as ch (ch)}
              {#if channels.length === 1}
                <span class="chan-ic" title={ch}>
                  <ChannelBrandIcon channel={ch} size={iconSizes.sm} />
                </span>
              {:else}
                <Button
                  type="button"
                  class="chan-btn {effectiveSel.includes(ch) ? 'on' : ''}"
                  aria-pressed={effectiveSel.includes(ch)}
                  aria-label={ch}
                  title={ch}
                  onclick={() => clickChannel(ch)}
                >
                  <ChannelBrandIcon channel={ch} size={iconSizes.sm} />
                </Button>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}
    </header>

    {#if selected}
      <div class="thread" bind:this={threadEl}>
        {#if threadLoading && thread.length === 0}
          <div class="thread-loading"><Spinner /></div>
        {/if}
        {#each thread as msg (msg.clientId)}
          <div class="bubble-row" class:outbound={msg.direction === 'outbound'}>
            <div
              class="bubble"
              class:outbound={msg.direction === 'outbound'}
              class:pending={msg.pending}
              class:failed={msg.failed}
            >
              {#if selected.isGroup && msg.direction === 'inbound' && msg.senderName}
                <span class="bubble-sender">{msg.senderName}</span>
              {/if}
              {#if msg.content?.trim()}
                <span class="bubble-text">{msg.content}</span>
              {:else}
                <!-- Media/attachment rows arrive with empty content (IG polling
                     can't fetch the payload) — label them instead of a blank bubble. -->
                <span class="bubble-media">
                  <Paperclip size={iconSizes.xs} />
                  {m.omni_attachment()}
                </span>
              {/if}
              <span class="bubble-when">
                {#if msg.failed}{m.omni_sendFailed()}{:else if msg.occurredAt}{fmtTimeAgo(
                    Date.parse(msg.occurredAt),
                  )}{/if}
              </span>
            </div>
          </div>
        {/each}
      </div>
      <div class="reply-row">
        <input
          type="text"
          class="reply-input"
          placeholder={m.chat_reply()}
          bind:value={draft}
          onkeydown={(e) => {
            if (e.key === 'Enter') void sendReply();
          }}
          aria-label={m.chat_reply()}
        />
        <Button
          type="button"
          class="reply-send"
          aria-label={m.chat_send()}
          disabled={!draft.trim()}
          onclick={() => void sendReply()}
        >
          <SendHorizontal size={iconSizes.sm} />
        </Button>
      </div>
    {:else}
      <div class="rows" role="list">
        {#if loaded && convos.length === 0}
          <EmptyState title={m.omni_empty()} icon={MessagesSquare} compact />
        {/if}
        {#each visible as c (`${c.channel}:${c.chatId}`)}
          <div
            class="row"
            role="button"
            tabindex="0"
            draggable="true"
            ondragstart={(e) => chatDragStart(e, c)}
            onclick={() => openThread(c)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openThread(c);
              }
            }}
            title={m.note_dragIntoChat()}
          >
            <span class="grip" aria-hidden="true"><GripVertical size={iconSizes.xs} /></span>
            <div class="row-main">
              <div class="row-top">
                <span class="row-chan" title={c.channel} aria-hidden="true">
                  <ChannelBrandIcon channel={c.channel} size={iconSizes.xs} />
                </span>
                <span class="name">{displayName(c)}</span>
                {#if c.isGroup}<span class="group-ic" aria-hidden="true"
                    ><Users size={iconSizes.xs} /></span
                  >{/if}
                <span class="when">{c.occurredAt ? fmtTimeAgo(c.occurredAt) : ''}</span>
              </div>
              <div class="row-bottom">
                <span class="snippet" class:outbound={c.direction === 'outbound'}>
                  {#if c.direction === 'outbound'}↩{/if}
                  {c.content ?? ''}
                </span>
              </div>
            </div>
          </div>
        {/each}
        {#if hasMore && convos.length > 0}
          <Button
            type="button"
            class="load-more"
            disabled={loadingMore}
            onclick={() => void loadMore()}
          >
            {#if loadingMore}<Spinner />{:else}{m.omni_loadMore()}{/if}
          </Button>
        {/if}
      </div>
    {/if}

    <!-- Bottom-most dock section owns the collapse control (notes' own footer
         is hidden by the page when omnichat is visible below it). -->
    <footer class="panel-foot">
      <Button
        type="button"
        class="omni-collapse-row"
        onclick={togglePanel}
        aria-label={m.note_collapsePanel()}
      >
        <PanelRightClose size={iconSizes.md} />
        <span>{m.note_collapse()}</span>
      </Button>
    </footer>
  </aside>
{/if}

<style>
  .omni-panel {
    position: relative;
    width: 320px;
    flex-shrink: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--color-bg);
    border-left: 1px solid var(--color-border);
  }
  .omni-panel.collapsed {
    width: 46px;
    flex: 1;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-3) var(--space-2);
    flex-shrink: 0;
  }
  .head-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--font-size-body);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
  }
  .head-title :global(svg) {
    color: var(--color-accent);
  }
  .thread-head {
    flex: 1;
  }
  .omni-panel :global(.back-btn) {
    flex-shrink: 0;
    display: inline-flex;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
  }
  .omni-panel :global(.back-btn):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }
  .thread-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Subtle gray brand mark: rows, thread header. */
  .row-chan {
    flex-shrink: 0;
    display: inline-flex;
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
  }

  /* Header channel filter icons. */
  .chan-filter {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    flex-shrink: 0;
  }
  .chan-ic {
    display: inline-flex;
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
  }
  .omni-panel :global(.chan-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-xs);
    height: var(--control-height-xs);
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .omni-panel :global(.chan-btn):hover {
    color: color-mix(in srgb, var(--color-foreground) 65%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }
  .omni-panel :global(.chan-btn.on) {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  /* ─── Thread view ─── */
  .thread {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: var(--space-1) var(--space-2) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .thread-loading {
    display: flex;
    justify-content: center;
    padding: var(--space-6) 0;
  }
  .bubble-row {
    display: flex;
    justify-content: flex-start;
  }
  .bubble-row.outbound {
    justify-content: flex-end;
  }
  .bubble {
    max-width: 85%;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 88%, transparent);
  }
  .bubble.outbound {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .bubble.pending {
    opacity: 0.6;
  }
  .bubble.failed {
    border: 1px solid var(--color-danger-border);
    background: var(--color-danger-surface);
  }
  .bubble-sender {
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-accent) 85%, transparent);
  }
  .bubble-text {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.4;
  }
  .bubble-media {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-style: italic;
    color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
  }
  .bubble-when {
    align-self: flex-end;
    font-size: var(--font-size-telemetry);
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .bubble.failed .bubble-when {
    color: var(--color-danger-fg);
  }

  .reply-row {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    border-top: 1px solid var(--color-border);
  }
  .reply-input {
    flex: 1;
    min-width: 0;
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
    font-size: var(--font-size-caption);
    font-family: inherit;
    outline: none;
  }
  .reply-input:focus {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }
  .reply-input::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
  }
  .omni-panel :global(.reply-send) {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    border-radius: var(--radius-lg);
    cursor: pointer;
    border: none;
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .omni-panel :global(.reply-send):disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ─── Conversation list ─── */
  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: var(--space-0-5) var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: background var(--duration-fast) ease;
  }
  .row:hover {
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }
  .grip {
    flex-shrink: 0;
    display: inline-flex;
    margin-top: var(--space-0-5);
    cursor: grab;
    color: color-mix(in srgb, var(--color-foreground) 22%, transparent);
  }
  .grip:active {
    cursor: grabbing;
  }
  .row:hover .grip {
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .row-top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
  }
  .group-ic {
    flex-shrink: 0;
    display: inline-flex;
    color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
  }
  .when {
    flex-shrink: 0;
    font-size: var(--font-size-telemetry);
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .row-bottom {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }
  .snippet {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
  }
  .snippet.outbound {
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }

  .omni-panel :global(.load-more) {
    flex-shrink: 0;
    margin-top: var(--space-1);
    height: var(--control-height-sm);
    border: none;
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
    font-size: var(--font-size-caption);
    font-family: inherit;
  }
  .omni-panel :global(.load-more):hover {
    background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
    color: var(--color-foreground);
  }

  /* Bottom collapse control + collapsed rail mirror NotesPanel's idiom. */
  .panel-foot {
    flex-shrink: 0;
    padding: var(--space-2);
    border-top: 1px solid var(--color-border);
  }
  .omni-panel :global(.omni-collapse-row) {
    width: 100%;
    height: 2.25rem;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--font-size-caption);
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--color-muted);
    font-family: inherit;
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .omni-panel :global(.omni-collapse-row > span) {
    gap: var(--space-3);
  }
  .omni-panel :global(.omni-collapse-row):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }

  .omni-panel :global(.omni-rail) {
    flex: 1;
    min-height: 0;
    width: 100%;
    padding: var(--space-12) 0 var(--space-4);
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--color-muted);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .omni-panel :global(.omni-rail > span) {
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }
  .omni-panel :global(.omni-rail):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }
  .rail-icon {
    display: inline-flex;
    color: var(--color-accent);
  }
  .rail-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--color-muted-foreground);
  }
</style>
