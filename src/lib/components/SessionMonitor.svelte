<!-- src/lib/components/SessionMonitor.svelte -->
<script lang="ts">
  import { agentChat } from '$lib/state/chat.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { parseToolCallRuns, type Run, type ToolCall } from '$lib/utils/tool-calls';
  import type { ChatMessage } from '$lib/types/chat';

  let {
    agentId,
    sessionKey,
    serverId,
  }: {
    agentId: string;
    sessionKey: string | null;
    serverId: string | null;
  } = $props();

  const mainSessionKey = $derived(`agent:${agentId}:main`);
  const isMainSession = $derived(sessionKey === mainSessionKey);

  let nonMainMessages = $state<ChatMessage[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Track which session the currently selected run belongs to so we can reset
  // when the session changes without an $effect that only writes state.
  let selectedRunSession = $state<string | null>(null);
  let _selectedRunIdx = $state(0);

  const selectedRunIdx = $derived.by(() => {
    if (selectedRunSession !== sessionKey) return 0;
    return _selectedRunIdx;
  });

  const messages = $derived(
    isMainSession ? (agentChat[agentId]?.messages ?? []) : nonMainMessages,
  );

  const runs = $derived(parseToolCallRuns(messages));
  const displayedRuns = $derived([...runs].reverse()); // newest first
  const selectedRun = $derived(displayedRuns[selectedRunIdx] ?? null);

  function selectRun(i: number) {
    selectedRunSession = sessionKey;
    _selectedRunIdx = i;
  }

  $effect(() => {
    const sk = sessionKey;
    const sid = serverId;
    if (!sk || isMainSession) {
      nonMainMessages = [];
      return;
    }
    loadMessages(sk, sid);
  });

  async function loadMessages(sk: string, sid: string | null) {
    loading = true;
    error = null;
    nonMainMessages = [];
    try {
      if (sid) {
        const res = await fetch(
          `/api/servers/${sid}/sessions/${encodeURIComponent(sk)}/messages`,
        );
        if (res.ok) {
          const data = (await res.json()) as { messages?: ChatMessage[] };
          if (data.messages && data.messages.length > 0) {
            nonMainMessages = data.messages;
            loading = false;
            return;
          }
        }
      }
      const wsRes = (await sendRequest('chat.history', { sessionKey: sk, limit: 9999 })) as {
        messages?: ChatMessage[];
      } | null;
      nonMainMessages = wsRes?.messages ?? [];
    } catch (e) {
      error = (e as Error).message ?? 'Failed to load';
    } finally {
      loading = false;
    }
  }

  function fmtDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function toolEmoji(name: string): string {
    const l = name.toLowerCase();
    if (/^(bash|execute|run_|shell)/.test(l)) return '⚡';
    if (/^(read_|view_|get_file|str_replace_editor)/.test(l)) return '📄';
    if (/^(write_|create_|edit_|str_replace)/.test(l)) return '✏️';
    if (/^(search_|grep_|find_|glob_)/.test(l)) return '🔍';
    if (/^(fetch|http_|web_|curl_|webfetch|websearch)/.test(l)) return '🌐';
    if (/^mcp__/.test(l)) return '🔌';
    return '🔧';
  }

  function toolColor(name: string): string {
    const l = name.toLowerCase();
    if (/^(bash|execute|run_|shell)/.test(l)) return '#f59e0b';
    if (/^(read_|view_|get_file|str_replace_editor)/.test(l)) return '#3b82f6';
    if (/^(write_|create_|edit_|str_replace)/.test(l)) return '#22c55e';
    if (/^(search_|grep_|find_|glob_)/.test(l)) return '#a855f7';
    if (/^(fetch|http_|web_|curl_|webfetch|websearch)/.test(l)) return '#06b6d4';
    if (/^mcp__/.test(l)) return '#ec4899';
    return '#64748b';
  }

  function leftPct(tc: ToolCall, run: Run): number {
    const span = run.endTs - run.startTs;
    if (span <= 0) return 0;
    return ((tc.startTs - run.startTs) / span) * 100;
  }

  function widthPct(tc: ToolCall, run: Run): number {
    const span = run.endTs - run.startTs;
    if (tc.durationMs === null || span <= 0) return 0.5;
    return Math.max((tc.durationMs / span) * 100, 0.5);
  }
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden bg-bg">
  {#if !sessionKey}
    <div class="flex-1 flex items-center justify-center text-muted text-xs">
      Select a session to monitor
    </div>
  {:else if loading}
    <div class="flex-1 flex items-center justify-center gap-2 text-muted text-xs">
      <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
      Loading...
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center text-destructive text-xs">
      Error: {error}
    </div>
  {:else if runs.length === 0}
    <div class="flex-1 flex flex-col items-center justify-center gap-2 text-muted text-xs">
      <span class="text-2xl opacity-30">📭</span>
      <span>No tool calls in this session</span>
    </div>
  {:else}
    <!-- Run tabs -->
    <div
      class="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border bg-bg2 overflow-x-auto"
    >
      {#each displayedRuns as run, i (run.idx)}
        <button
          class="text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors shrink-0 cursor-pointer
            {selectedRunIdx === i
            ? 'bg-accent/15 border-accent/30 text-accent'
            : 'border-border bg-bg3 text-muted hover:text-foreground'}"
          onclick={() => selectRun(i)}
        >
          Run {run.idx}
        </button>
      {/each}
    </div>

    {#if selectedRun}
      <!-- Run header -->
      <div
        class="shrink-0 px-3 py-2 border-b border-border bg-bg2 flex items-center gap-3"
      >
        <span class="text-xs font-semibold text-foreground truncate flex-1 min-w-0">
          {selectedRun.userPrompt || `Run ${selectedRun.idx}`}
        </span>
        <span class="text-[10px] text-muted shrink-0"
          >{selectedRun.toolCalls.length} call{selectedRun.toolCalls.length === 1 ? '' : 's'}</span
        >
        <span class="text-[10px] text-muted shrink-0"
          >{fmtDuration(selectedRun.endTs - selectedRun.startTs)}</span
        >
      </div>

      <!-- Column headers -->
      <div
        class="shrink-0 flex items-center px-3 py-1.5 bg-bg border-b border-border text-[9px] font-bold uppercase tracking-widest text-muted"
      >
        <span class="w-[160px] shrink-0">Tool</span>
        <span class="flex-1 min-w-0 ml-2">Timeline</span>
        <span class="w-[60px] text-right shrink-0">Duration</span>
      </div>

      <!-- Waterfall rows -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        {#each selectedRun.toolCalls as tc (tc.id)}
          <div
            class="flex items-center px-3 py-1.5 border-b border-border/50 hover:bg-white/[0.02] group"
          >
            <!-- Tool name -->
            <span
              class="w-[160px] shrink-0 flex items-center gap-1.5 font-mono overflow-hidden"
            >
              <span class="text-[11px] shrink-0">{toolEmoji(tc.name)}</span>
              <span class="text-[11px] text-foreground truncate">{tc.name}</span>
            </span>

            <!-- Timeline bar -->
            <div class="relative flex-1 min-w-0 h-5 mx-2">
              <div
                class="absolute top-1/2 -translate-y-1/2 h-3 rounded-[2px] opacity-75 group-hover:opacity-100 transition-opacity"
                style:left="{leftPct(tc, selectedRun)}%"
                style:width="{widthPct(tc, selectedRun)}%"
                style:background-color={toolColor(tc.name)}
              ></div>
            </div>

            <!-- Duration -->
            <span class="w-[60px] text-right text-[10px] font-mono text-muted shrink-0">
              {fmtDuration(tc.durationMs)}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
