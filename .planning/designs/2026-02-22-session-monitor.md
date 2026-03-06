# Session Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Monitor" tab to the `AgentDetail` panel showing a Chrome DevTools–style waterfall timeline of tool calls parsed from the selected session's chat messages.

**Architecture:** A new utility (`tool-calls.ts`) parses `tool_use`/`tool_result` content blocks from chat messages into typed `Run[]` objects with timing data. A new `SessionMonitor.svelte` component reads those runs and renders a CSS-based waterfall. A tab toggle in `AgentDetail.svelte` switches between the existing chat view and the monitor.

**Tech Stack:** Svelte 5 runes, Vitest, Tailwind CSS, existing gateway WS / REST fetch patterns.

---

### Task 1: Tool Call Parser Utility (TDD)

**Files:**
- Create: `src/lib/utils/tool-calls.ts`
- Create: `src/lib/utils/tool-calls.test.ts`

**Step 1: Create the test file**

```typescript
// src/lib/utils/tool-calls.test.ts
import { describe, it, expect } from 'vitest';
import { parseToolCallRuns } from './tool-calls';
import type { ChatMessage } from '$lib/types/chat';

// Helper to build a minimal ChatMessage
function msg(role: 'user' | 'assistant', content: ChatMessage['content'], timestamp: number): ChatMessage {
  return { role, content, timestamp };
}

describe('parseToolCallRuns', () => {
  it('returns empty array for empty messages', () => {
    expect(parseToolCallRuns([])).toEqual([]);
  });

  it('returns empty array when no tool calls exist', () => {
    const messages: ChatMessage[] = [
      msg('user', 'hello', 1000),
      msg('assistant', 'hi there', 2000),
    ];
    expect(parseToolCallRuns(messages)).toEqual([]);
  });

  it('parses a single run with one tool call', () => {
    const messages: ChatMessage[] = [
      msg('user', 'do something', 1000),
      msg('assistant', [
        { type: 'text', text: 'Sure' },
        { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls' } },
      ], 2000),
      msg('user', [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1\nfile2' },
      ], 3000),
      msg('assistant', 'Done', 4000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].idx).toBe(1);
    expect(runs[0].userPrompt).toBe('do something');
    expect(runs[0].startTs).toBe(1000);
    expect(runs[0].endTs).toBe(4000);
    expect(runs[0].toolCalls).toHaveLength(1);

    const tc = runs[0].toolCalls[0];
    expect(tc.id).toBe('toolu_1');
    expect(tc.name).toBe('bash');
    expect(tc.startTs).toBe(2000);
    expect(tc.endTs).toBe(3000);
    expect(tc.durationMs).toBe(1000);
    expect(tc.result).toBe('file1\nfile2');
  });

  it('parses multiple tool calls in one assistant turn', () => {
    const messages: ChatMessage[] = [
      msg('user', 'do two things', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_a', name: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool_use', id: 'tc_b', name: 'bash', input: { command: 'pwd' } },
      ], 2000),
      msg('user', [
        { type: 'tool_result', tool_use_id: 'tc_a', content: 'content a' },
        { type: 'tool_result', tool_use_id: 'tc_b', content: '/home' },
      ], 3500),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].toolCalls).toHaveLength(2);
    expect(runs[0].toolCalls[0].durationMs).toBe(1500);
    expect(runs[0].toolCalls[1].durationMs).toBe(1500);
  });

  it('creates separate runs for separate user messages', () => {
    const messages: ChatMessage[] = [
      msg('user', 'first task', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
      msg('user', [{ type: 'tool_result', tool_use_id: 'tc_1', content: '' }], 3000),
      msg('assistant', 'done', 4000),
      msg('user', 'second task', 5000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_2', name: 'write_file', input: {} },
      ], 6000),
      msg('user', [{ type: 'tool_result', tool_use_id: 'tc_2', content: '' }], 7000),
      msg('assistant', 'done 2', 8000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(2);
    expect(runs[0].idx).toBe(1);
    expect(runs[0].userPrompt).toBe('first task');
    expect(runs[1].idx).toBe(2);
    expect(runs[1].userPrompt).toBe('second task');
  });

  it('handles tool call with no matching result (endTs null)', () => {
    const messages: ChatMessage[] = [
      msg('user', 'run this', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_orphan', name: 'bash', input: {} },
      ], 2000),
      // No tool_result follows
      msg('assistant', 'partial response', 3000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    const tc = runs[0].toolCalls[0];
    expect(tc.endTs).toBeNull();
    expect(tc.durationMs).toBeNull();
  });

  it('truncates long user prompts to 80 chars', () => {
    const longMsg = 'x'.repeat(120);
    const messages: ChatMessage[] = [
      msg('user', longMsg, 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs[0].userPrompt.length).toBeLessThanOrEqual(80);
  });

  it('extracts user prompt from content block arrays', () => {
    const messages: ChatMessage[] = [
      msg('user', [{ type: 'text', text: 'do the thing' }], 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs[0].userPrompt).toBe('do the thing');
  });
});
```

**Step 2: Run tests to confirm they all fail**

```bash
bun run vitest run src/lib/utils/tool-calls.test.ts
```

Expected: all tests fail with "Cannot find module './tool-calls'"

**Step 3: Create the implementation**

```typescript
// src/lib/utils/tool-calls.ts
import type { ChatMessage } from '$lib/types/chat';

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  startTs: number;
  endTs: number | null;
  durationMs: number | null;
  result: string | null;
}

export interface Run {
  idx: number;
  userPrompt: string;
  startTs: number;
  endTs: number;
  toolCalls: ToolCall[];
}

type Block = { type: string; [key: string]: unknown };

function isBlockArray(content: unknown): content is Block[] {
  return Array.isArray(content);
}

function extractPrompt(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (isBlockArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => (b.text as string) ?? '')
      .join('');
  }
  return '';
}

function hasToolResults(content: ChatMessage['content']): boolean {
  if (!isBlockArray(content)) return false;
  return content.some((b) => b.type === 'tool_result');
}

export function parseToolCallRuns(messages: ChatMessage[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  const pending = new Map<string, ToolCall>();

  for (const msg of messages) {
    const ts = msg.timestamp ?? 0;

    if (msg.role === 'user') {
      if (hasToolResults(msg.content)) {
        // Resolve pending tool calls
        const blocks = isBlockArray(msg.content) ? msg.content : [];
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const tc = pending.get(block.tool_use_id as string);
            if (tc) {
              tc.endTs = ts;
              tc.durationMs = ts - tc.startTs;
              const c = block.content;
              tc.result = typeof c === 'string' ? c : c != null ? JSON.stringify(c) : null;
              pending.delete(block.tool_use_id as string);
            }
          }
        }
        if (current) current.endTs = ts;
      } else {
        // New run boundary
        if (current && current.toolCalls.length > 0) runs.push(current);
        const prompt = extractPrompt(msg.content).slice(0, 80);
        current = { idx: runs.length + 1, userPrompt: prompt, startTs: ts, endTs: ts, toolCalls: [] };
      }
    } else if (msg.role === 'assistant') {
      if (!current) continue;
      if (isBlockArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            const tc: ToolCall = {
              id: block.id as string,
              name: block.name as string,
              input: block.input,
              startTs: ts,
              endTs: null,
              durationMs: null,
              result: null,
            };
            current.toolCalls.push(tc);
            pending.set(tc.id, tc);
          }
        }
      }
      current.endTs = ts;
    }
  }

  if (current && current.toolCalls.length > 0) runs.push(current);
  return runs;
}
```

**Step 4: Run tests to confirm they all pass**

```bash
bun run vitest run src/lib/utils/tool-calls.test.ts
```

Expected: all 8 tests pass

**Step 5: Commit**

```bash
git add src/lib/utils/tool-calls.ts src/lib/utils/tool-calls.test.ts
git commit -m "feat: add tool-calls parser utility"
```

---

### Task 2: SessionMonitor Component

**Files:**
- Create: `src/lib/components/SessionMonitor.svelte`

> **Note:** Use the `svelte:svelte-file-editor` agent (or the `svelte-autofixer` MCP tool) when writing this .svelte file to catch Svelte 5 runes issues.

**Step 1: Create the component**

```svelte
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
  let selectedRunIdx = $state(0);

  const messages = $derived(
    isMainSession ? (agentChat[agentId]?.messages ?? []) : nonMainMessages,
  );

  const runs = $derived(parseToolCallRuns(messages));
  const displayedRuns = $derived([...runs].reverse()); // newest first
  const selectedRun = $derived(displayedRuns[selectedRunIdx] ?? null);

  $effect(() => {
    // Reset tab when session changes
    const _sk = sessionKey;
    selectedRunIdx = 0;
  });

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
          onclick={() => (selectedRunIdx = i)}
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
```

**Step 2: Run svelte-check to catch any Svelte 5 issues**

```bash
bun run check
```

Expected: no errors (or fix any Svelte 5 runes issues flagged)

**Step 3: Commit**

```bash
git add src/lib/components/SessionMonitor.svelte
git commit -m "feat: add SessionMonitor waterfall component"
```

---

### Task 3: Wire Tab Toggle into AgentDetail

**Files:**
- Modify: `src/lib/components/AgentDetail.svelte`

**Step 1: Apply the following diff**

Read the current file first, then make these exact changes:

1. Add `SessionMonitor` import alongside existing imports:
```svelte
import SessionMonitor from './SessionMonitor.svelte';
```

2. Add a local tab state variable after the existing `$props()` line:
```svelte
let activeTab = $state<'chat' | 'monitor'>('chat');
```

3. Replace the main content div (the `flex-1 min-h-0 flex flex-col overflow-hidden` div that wraps SessionViewer + ChatPanel) with this:
```svelte
  <!-- Tab bar -->
  <div class="shrink-0 flex items-center gap-0 border-b border-border bg-bg2">
    <button
      class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
        {activeTab === 'chat'
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-foreground'}"
      onclick={() => (activeTab = 'chat')}
    >
      Chat
    </button>
    <button
      class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
        {activeTab === 'monitor'
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-foreground'}"
      onclick={() => (activeTab = 'monitor')}
    >
      Monitor
    </button>
  </div>

  <!-- Main content: chat or monitor -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if activeTab === 'monitor'}
      <SessionMonitor
        {agentId}
        sessionKey={ui.selectedSessionKey}
        serverId={ui.selectedServerId}
      />
    {:else}
      {#if !isMainSession && ui.selectedSessionKey}
        <SessionViewer
          serverId={ui.selectedServerId}
          sessionKey={ui.selectedSessionKey}
          session={selectedSessionRow}
        />
      {/if}
      <ChatPanel {agentId} readonly={!isMainSession} />
    {/if}
  </div>
```

**Step 2: Run svelte-check**

```bash
bun run check
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/lib/components/AgentDetail.svelte
git commit -m "feat: add Chat/Monitor tab toggle to AgentDetail"
```

---

### Task 4: Manual Smoke Test

**Step 1: Start dev server**

```bash
bun run dev
```

Open the app in a browser at `http://localhost:5173`.

**Step 2: Verify Chat tab (regression check)**

- Connect to a gateway
- Select an agent → confirm the chat view works exactly as before
- Send a message, verify it appears

**Step 3: Verify Monitor tab**

- Click "Monitor" tab
- Select a session that has had tool calls (any non-trivial agent run)
- Confirm:
  - Run tabs appear at top (newest first)
  - Each run shows tool call rows with emoji + name + colored bar + duration
  - Bar widths are proportional to duration (longer calls = wider bars)
  - Clicking a different run tab switches the waterfall

**Step 4: Verify non-main session**

- Use the session dropdown to select a non-main session (e.g. a WhatsApp session)
- Switch to Monitor tab
- Confirm it loads and shows tool calls from that session

**Step 5: Verify empty state**

- Select the Monitor tab for an agent with no tool calls
- Confirm "No tool calls in this session" message appears

**Step 6: Commit final check**

```bash
bun run check && bun run test
```

Expected: all tests pass, no type errors.

```bash
git add -p
git commit -m "feat: session monitor complete"
```
