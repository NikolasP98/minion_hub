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
      const wsRes = await sendRequest('chat.history', { sessionKey: sk, limit: 1000 }) as {
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

<div class="flex-1 min-h-0 flex flex-col overflow-hidden bg-bg">
  {#if !sessionKey}
    <div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-muted text-[13px]">
      <span class="text-[28px] opacity-40">{'\u2B05'}</span>
      <span>Select a session to view transcript</span>
    </div>
  {:else}
    <!-- Session header -->
    <div class="shrink-0 px-4 py-2.5 border-b border-border bg-bg2 flex flex-col gap-[5px]">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{displayName}</span>
        <span
          class="text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-[2px] rounded-[10px] shrink-0
            {statusColor(session?.status) === 'green' ? 'bg-success/15 text-success' : ''}
            {statusColor(session?.status) === 'amber' ? 'bg-warning/15 text-warning' : ''}
            {statusColor(session?.status) === 'grey'  ? 'bg-[rgba(71,85,105,0.2)] text-[#94a3b8]' : ''}"
        >
          {statusLabel(session?.status)}
        </span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        {#if session?.agentId}
          <span class="text-[10px] font-semibold text-accent bg-accent/12 rounded-[10px] px-[7px] py-[1px] whitespace-nowrap">{session.agentId}</span>
        {/if}
        <span class="font-mono text-[10px] text-muted overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{sessionKey}</span>
        {#if session?.updatedAt}
          <span class="text-[10px] text-muted whitespace-nowrap">{relTime(session.updatedAt)}</span>
        {/if}
        {#if totalTokens !== null}
          <span class="text-[10px] text-muted whitespace-nowrap px-1.5 py-[1px] bg-bg3 rounded-lg border border-border">{totalTokens.toLocaleString()} tokens</span>
        {/if}
      </div>
    </div>

    <!-- Messages scroll area -->
    <div class="flex-1 min-h-0 overflow-y-auto p-3 px-4 flex flex-col gap-2 scrollbar-thin scrollbar-color-border" bind:this={scrollEl}>
      {#if loading}
        <div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-muted text-xs">
          <div class="w-[22px] h-[22px] border-2 border-border border-t-accent rounded-full animate-spin"></div>
          <span>Loading transcript...</span>
        </div>
      {:else if error}
        <div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-destructive text-xs">
          <span>Error: {error}</span>
        </div>
      {:else if messages.filter((m) => m.content.trim()).length === 0}
        <div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-muted text-xs">
          <span>No messages in this session.</span>
        </div>
      {:else}
        {#each messages.filter((m) => m.content.trim()) as msg (msg.id)}
          <div
            class="max-w-[82%] px-3 py-2 rounded-lg font-mono text-xs leading-[1.55] break-words whitespace-pre-wrap
              {msg.role === 'user'
                ? 'self-end bg-brand-pink text-white rounded-br-[3px]'
                : 'self-start bg-bg3 text-foreground rounded-bl-[3px] border border-border'}"
          >
            {msg.content}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>
