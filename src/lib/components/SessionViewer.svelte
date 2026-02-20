<script lang="ts">
  import { onMount } from 'svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import type { SessionRow } from './SessionsList.svelte';

  let {
    serverId,
    sessionKey,
    session,
  }: {
    serverId: string | null;
    sessionKey: string | null;
    session: SessionRow | null;
  } = $props();

  type DbMessage = {
    id: string;
    serverId: string;
    agentId: string;
    sessionKey: string;
    role: string;
    content: string;
    runId: string | null;
    timestamp: number;
    createdAt: number;
  };

  type WsMessage = {
    role: string;
    content: string | unknown;
    timestamp?: number;
  };

  let messages = $state<DbMessage[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);

  function extractContent(msg: WsMessage): string {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
    }
    return String(msg.content ?? '');
  }

  function relTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function parseMeta(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }

  async function loadMessages(sid: string, sk: string) {
    loading = true;
    error = null;
    messages = [];

    try {
      // 1. Check hub DB cache first
      const cacheRes = await fetch(
        `/api/servers/${sid}/sessions/${encodeURIComponent(sk)}/messages`,
      );
      if (cacheRes.ok) {
        const data = await cacheRes.json() as { messages: DbMessage[] };
        if (data.messages && data.messages.length > 0) {
          messages = data.messages;
          loading = false;
          scrollToBottom();
          return;
        }
      }

      // 2. Fall back to WS gateway
      const wsRes = await sendRequest('chat.history', { sessionKey: sk, limit: 9999 }) as {
        messages: WsMessage[];
      } | null;

      const wsMsgs: WsMessage[] = wsRes?.messages ?? [];

      if (wsMsgs.length > 0) {
        // 3. Cache them in hub DB
        try {
          await fetch(`/api/servers/${sid}/sessions/${encodeURIComponent(sk)}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: wsMsgs }),
          });
        } catch {
          // non-critical — cache write failure doesn't block display
        }

        // Re-fetch from DB so we have full DB-shaped rows (with ids etc.)
        try {
          const refetch = await fetch(
            `/api/servers/${sid}/sessions/${encodeURIComponent(sk)}/messages`,
          );
          if (refetch.ok) {
            const refetchData = await refetch.json() as { messages: DbMessage[] };
            messages = refetchData.messages ?? [];
          }
        } catch {
          // Show WS messages directly as fallback
          messages = wsMsgs.map((m, i) => ({
            id: String(i),
            serverId: sid,
            agentId: session?.agentId ?? '',
            sessionKey: sk,
            role: m.role,
            content: extractContent(m),
            runId: null,
            timestamp: m.timestamp ?? Date.now(),
            createdAt: m.timestamp ?? Date.now(),
          }));
        }
      }
    } catch (e) {
      error = (e as Error).message ?? 'Failed to load messages';
    } finally {
      loading = false;
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    }, 50);
  }

  // Re-load whenever sessionKey or serverId change
  $effect(() => {
    const sk = sessionKey;
    const sid = serverId;
    if (sk && sid) {
      loadMessages(sid, sk);
    } else {
      messages = [];
      error = null;
    }
  });

  const meta = $derived(parseMeta(session?.metadata ?? null));
  const displayName = $derived(
    (typeof meta.displayName === 'string' ? meta.displayName : null) ??
    (typeof meta.label === 'string' ? meta.label : null) ??
    sessionKey ??
    ''
  );
  const totalTokens = $derived(
    typeof meta.totalTokens === 'number' ? meta.totalTokens :
    typeof meta.tokens === 'number' ? meta.tokens : null
  );

  function statusLabel(status: string | undefined): string {
    if (!status) return 'unknown';
    return status;
  }
  function statusColor(status: string | undefined): string {
    if (status === 'running' || status === 'thinking') return 'green';
    if (status === 'idle') return 'amber';
    return 'grey';
  }
</script>

<div class="viewer">
  {#if !sessionKey}
    <div class="empty-state">
      <span class="empty-icon">⬅</span>
      <span>Select a session to view transcript</span>
    </div>
  {:else}
    <!-- Session header -->
    <div class="viewer-header">
      <div class="header-top">
        <span class="header-name">{displayName}</span>
        <span class="status-badge {statusColor(session?.status)}">
          {statusLabel(session?.status)}
        </span>
      </div>
      <div class="header-meta">
        {#if session?.agentId}
          <span class="agent-chip">{session.agentId}</span>
        {/if}
        <span class="sk-mono">{sessionKey}</span>
        {#if session?.updatedAt}
          <span class="rel-time">{relTime(session.updatedAt)}</span>
        {/if}
        {#if totalTokens !== null}
          <span class="tokens">{totalTokens.toLocaleString()} tokens</span>
        {/if}
      </div>
    </div>

    <!-- Messages scroll area -->
    <div class="messages" bind:this={scrollEl}>
      {#if loading}
        <div class="center-state">
          <div class="spinner"></div>
          <span>Loading transcript…</span>
        </div>
      {:else if error}
        <div class="center-state error-state">
          <span>Error: {error}</span>
        </div>
      {:else if messages.length === 0}
        <div class="center-state">
          <span>No messages in this session.</span>
        </div>
      {:else}
        {#each messages as msg (msg.id)}
          <div class="message {msg.role === 'user' ? 'user' : 'assistant'}">
            {msg.content}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  /* ── Empty state (no session selected) ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text2);
    font-size: 13px;
  }
  .empty-icon {
    font-size: 28px;
    opacity: 0.4;
  }

  /* ── Header ── */
  .viewer-header {
    flex-shrink: 0;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .header-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .status-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
  }
  .status-badge.green { background: rgba(34,197,94,0.15); color: var(--green); }
  .status-badge.amber { background: rgba(251,191,36,0.15); color: var(--amber); }
  .status-badge.grey  { background: rgba(71,85,105,0.2);  color: #94a3b8; }

  .header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .agent-chip {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    background: rgba(99,102,241,0.12);
    border-radius: 10px;
    padding: 1px 7px;
    white-space: nowrap;
  }

  .sk-mono {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--text2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .rel-time {
    font-size: 10px;
    color: var(--text2);
    white-space: nowrap;
  }

  .tokens {
    font-size: 10px;
    color: var(--text2);
    white-space: nowrap;
    padding: 1px 6px;
    background: var(--bg3);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  /* ── Messages ── */
  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .center-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text2);
    font-size: 12px;
  }
  .error-state { color: var(--red); }

  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .message {
    max-width: 82%;
    padding: 8px 12px;
    border-radius: 8px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 12px;
    line-height: 1.55;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .message.user {
    align-self: flex-end;
    background: var(--brand-pink);
    color: #fff;
    border-bottom-right-radius: 3px;
  }

  .message.assistant {
    align-self: flex-start;
    background: var(--bg3);
    color: var(--text);
    border-bottom-left-radius: 3px;
    border: 1px solid var(--border);
  }
</style>
