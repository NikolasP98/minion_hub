# Session Monitor Design

**Date:** 2026-02-22
**Status:** Approved

## Summary

Add a "Monitor" tab to the `AgentDetail` panel showing a Chrome DevTools–style waterfall timeline of tool calls for the selected session. Tool calls are parsed from existing chat message history (tool_use/tool_result content blocks), grouped into runs, with timing derived from message timestamps.

## Placement

A tab toggle ("Chat" / "Monitor") is added to the `AgentDetail` main content area. The existing chat+session view is unchanged when "Chat" is selected. Selecting "Monitor" replaces the content area with the `SessionMonitor` component.

## Data Source

Parse tool calls from the selected session's chat messages:
- **Main session** (`agent:{id}:main`): read directly from `agentChat[agentId].messages` (already loaded in state)
- **Other sessions** (WhatsApp, etc.): fetch from `/api/servers/${serverId}/sessions/${sessionKey}/messages`, falling back to WS `chat.history` — same pattern as `SessionViewer`

No gateway changes needed. Timing is approximate (message-level granularity).

## Data Model

```typescript
interface ToolCall {
  id: string;           // tool_use id from content block
  name: string;         // tool name (e.g. "bash", "read_file")
  input: unknown;       // tool input object
  startTs: number;      // timestamp of the assistant message containing tool_use
  endTs: number | null; // timestamp of the user message containing tool_result
  result: string | null;// tool result content (string or serialized)
}

interface Run {
  idx: number;          // 1-based run index
  userPrompt: string;   // truncated first user message of this run
  startTs: number;      // timestamp of initial user message
  endTs: number;        // timestamp of last message in the run
  toolCalls: ToolCall[];
}
```

**Parsing algorithm:**
1. Iterate messages in order
2. A new Run starts when a user message is encountered that does NOT contain `tool_result` blocks
3. Within a run, collect `tool_use` blocks from assistant messages (record `startTs = message.timestamp`)
4. Match `tool_result` blocks in subsequent user messages by `tool_use_id` (record `endTs = message.timestamp`)
5. Runs with zero tool calls are excluded from the display

## Waterfall Visualization

```
Run #3  •  2.3s  •  5 calls
──────────────────────────────────────────────────────
⚡ bash               ██████                    483ms
📄 read_file                  ████               48ms
✏️  write_file                    ██████████     124ms
⚡ bash                                   ████    48ms
🔍 search_files                               ██  12ms
```

- **Left column** (fixed ~160px): tool emoji + name (truncated)
- **Center column** (flexible): timeline bar, CSS `position: absolute` within relative container; `left` and `width` are percentages of total run duration
- **Right column** (fixed ~60px): duration in ms/s

**Bar positioning:**
- `left = (toolCall.startTs - run.startTs) / (run.endTs - run.startTs) * 100%`
- `width = max((toolCall.endTs - toolCall.startTs) / (run.endTs - run.startTs) * 100%, 0.5%)`
- Minimum bar width of 0.5% to keep very fast calls visible

**Color coding by tool family:**

| Family | Color | Matches |
|--------|-------|---------|
| Shell/exec | amber | `bash`, `execute_*`, `run_*`, `shell_*` |
| Read ops | blue | `read_*`, `view_*`, `get_file`, `str_replace_editor` (read) |
| Write ops | green | `write_*`, `create_*`, `edit_*`, `str_replace_*` |
| Search | purple | `search_*`, `grep_*`, `find_*`, `glob_*` |
| Web/fetch | cyan | `fetch`, `http_*`, `web_*`, `curl_*`, `WebFetch`, `WebSearch` |
| MCP tools | hashed | `mcp__*` — hash namespace to a hue |
| Other | gray | fallback |

**Run navigation:** Tabs at the top showing "Run 1", "Run 2", …, "Run N" (last 10, newest first). Newest run is selected by default.

**Empty states:**
- No session selected → prompt to select a session
- Session has messages but no tool calls → "No tool calls in this session"
- Still loading → spinner

## Files Changed

| File | Type | Change |
|------|------|--------|
| `src/lib/state/ui.svelte.ts` | Modify | Add `agentTab: 'chat' \| 'monitor'` |
| `src/lib/utils/tool-calls.ts` | Create | `parseToolCallRuns(messages)` → `Run[]` |
| `src/lib/components/SessionMonitor.svelte` | Create | Main monitor component |
| `src/lib/components/AgentDetail.svelte` | Modify | Tab toggle + conditional render |
