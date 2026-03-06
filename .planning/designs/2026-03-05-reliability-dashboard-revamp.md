# Reliability Dashboard Revamp — Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the reliability dashboard from basic HTML panels to rich ECharts visualizations, surface all dormant data (credentialSummaryJson, channelStatusJson, connection_events, event metadata), and add built-in tool execution tracking in openclaw.

**Architecture:** Two codebases: openclaw (gateway — adds new metrics capture) and minion_hub (dashboard — upgrades visualizations). openclaw changes use the existing `trackSkillExecution()` → buffer → push pipeline. Hub changes replace HTML panels with the `Chart.svelte` ECharts wrapper, surface dormant DB columns, and add new panels.

**Tech Stack:** SvelteKit, Svelte 5 runes, ECharts (via `Chart.svelte` wrapper), TypeScript, Drizzle ORM + libsql, openclaw gateway (Node.js)

---

## Phase 1: openclaw — Built-in Tool Execution Tracking

### Task 1.1: Create `wrapToolWithTracking()` utility

**Files:**
- Create: `src/logging/tool-tracking.ts` (in openclaw repo)

**Context:** Plugin tools are already tracked via `trackSkillExecution()` in `src/agents/pi-tool-definition-adapter.ts:124-204`. Built-in tools (browser, memory, web-fetch, web-search, image) bypass this because `getPluginToolMeta(tool)` returns `null` for them. We create a generic wrapper that any tool factory can use.

**Step 1: Create the tracking wrapper**

```typescript
// src/logging/tool-tracking.ts
import { trackSkillExecution } from "./reliability.js";

/**
 * Wraps an AnyAgentTool's execute function with duration/error tracking.
 * Reuses the existing skill stats pipeline (buffer → hub push).
 */
export function wrapToolWithTracking<T extends { execute: (...args: any[]) => Promise<any> }>(
  tool: T,
  trackingName: string,
): T {
  const originalExecute = tool.execute;

  tool.execute = async function (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    ...rest: unknown[]
  ) {
    const startTime = Date.now();
    try {
      const result = await originalExecute.call(this, toolCallId, params, signal, ...rest);
      trackSkillExecution({
        skillName: trackingName,
        status: "ok",
        durationMs: Date.now() - startTime,
        occurredAt: startTime,
      });
      return result;
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime;

      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        trackSkillExecution({
          skillName: trackingName,
          status: "timeout",
          durationMs: elapsed,
          occurredAt: startTime,
        });
        throw err;
      }

      const msg = err instanceof Error ? err.message : String(err);
      const lowerMsg = msg.toLowerCase();
      const isAuthError =
        lowerMsg.includes("unauthorized") ||
        lowerMsg.includes("auth") ||
        lowerMsg.includes("401") ||
        lowerMsg.includes("forbidden");

      trackSkillExecution({
        skillName: trackingName,
        status: isAuthError ? "auth_error" : "error",
        durationMs: elapsed,
        errorMessage: msg.slice(0, 200),
        occurredAt: startTime,
      });
      throw err;
    }
  } as typeof originalExecute;

  return tool;
}
```

**Step 2: Commit**

```bash
git add src/logging/tool-tracking.ts
git commit -m "feat: add wrapToolWithTracking utility for built-in tool metrics"
```

### Task 1.2: Apply tracking to all built-in tools

**Files:**
- Modify: `src/agents/tools/browser-tool.ts` — `createBrowserTool()` (line ~221)
- Modify: `src/agents/tools/memory-tool.ts` — `createMemorySearchTool()` (line ~40)
- Modify: `src/agents/tools/web-fetch.ts` — `createWebFetchTool()` (line ~712)
- Modify: `src/agents/tools/web-search.ts` — `createWebSearchTool()` (line ~843)
- Modify: `src/agents/tools/image-tool.ts` — `createImageTool()` (line ~334)

**Pattern:** Each tool factory returns `{ label, name, execute, ... }`. Wrap the returned object before returning:

```typescript
import { wrapToolWithTracking } from "../../logging/tool-tracking.js";

// At the end of each factory, before `return tool;`:
return wrapToolWithTracking(tool, "builtin:browser");
// or "builtin:memory_search", "builtin:web_fetch", "builtin:web_search", "builtin:image"
```

**Step 1: Add tracking to browser-tool.ts**

Import `wrapToolWithTracking` at top. Before the final `return` in `createBrowserTool()`, wrap:
```typescript
return wrapToolWithTracking(tool, "builtin:browser");
```
Where `tool` is the object literal currently being returned. Assign it to a `const tool = { ... }` first if needed.

**Step 2: Repeat for memory-tool.ts** — tracking name: `"builtin:memory_search"`

**Step 3: Repeat for web-fetch.ts** — tracking name: `"builtin:web_fetch"`

**Step 4: Repeat for web-search.ts** — tracking name: `"builtin:web_search"`

**Step 5: Repeat for image-tool.ts** — tracking name: `"builtin:image"`

**Step 6: Commit**

```bash
git add src/agents/tools/browser-tool.ts src/agents/tools/memory-tool.ts \
  src/agents/tools/web-fetch.ts src/agents/tools/web-search.ts src/agents/tools/image-tool.ts
git commit -m "feat: track built-in tool executions (browser, memory, web-fetch, web-search, image)"
```

### Task 1.3: Enrich heartbeat with channelStatusJson

**Files:**
- Modify: `src/gateway/hub-metrics-push.ts` (lines ~134-140 heartbeat construction, lines ~113-171 flush)

**Context:** The hub DB already has `channelStatusJson` column but the gateway never populates it. The channel health monitor has a `getRuntimeSnapshot()` method that returns `{ channelAccounts: { [channelId]: { [accountId]: { enabled, configured, running, connected, reconnectAttempts } } } }`.

**Step 1: Import channel manager and add to heartbeat**

In the `flush()` function of `hub-metrics-push.ts`, where the heartbeat object is constructed (~line 134):

```typescript
// Get channel status from the channel manager if available
let channelStatusJson: string | undefined;
try {
  const channelManager = getChannelManager?.();
  if (channelManager) {
    const snapshot = channelManager.getRuntimeSnapshot();
    channelStatusJson = JSON.stringify(snapshot);
  }
} catch { /* best effort */ }

const heartbeat = {
  uptimeMs: process.uptime() * 1000,
  activeSessions: ...,
  activeAgents: ...,
  memoryRssMb: ...,
  channelStatusJson,
  capturedAt: Date.now(),
};
```

The exact way to access the channel manager depends on how it's wired — check if there's a singleton accessor or if it needs to be passed in as a dependency to the push client constructor.

**Step 2: Commit**

```bash
git add src/gateway/hub-metrics-push.ts
git commit -m "feat: include channelStatusJson in heartbeat push to hub"
```

---

## Phase 2: minion_hub — Gateway Health Panel ECharts Upgrade

### Task 2.1: Update Heartbeat interface and API consumption

**Files:**
- Modify: `src/lib/components/reliability/GatewayHealthPanel.svelte`

**Context:** The GET endpoint at `src/routes/api/metrics/gateway-heartbeats/+server.ts` already returns ALL columns (uses `.select()` with no column filter). The component's `Heartbeat` interface (line 11-19) just doesn't include `credentialSummaryJson` or `channelStatusJson`.

**Step 1: Extend the Heartbeat interface**

```typescript
interface Heartbeat {
  id: number;
  serverId: string;
  uptimeMs: number;
  activeSessions: number;
  activeAgents: number;
  memoryRssMb: number | null;
  credentialSummaryJson: string | null;
  channelStatusJson: string | null;
  capturedAt: number;
}
```

**Step 2: Commit**

```bash
git add src/lib/components/reliability/GatewayHealthPanel.svelte
git commit -m "feat: extend Heartbeat interface with credentialSummary and channelStatus"
```

### Task 2.2: Replace SVG sparkline with ECharts multi-axis time series

**Files:**
- Modify: `src/lib/components/reliability/GatewayHealthPanel.svelte`

**Context:** Currently renders a 4-cell grid (uptime, sessions, agents, memory) + SVG sparkline. Replace with a `Chart.svelte` multi-axis line chart showing memory, sessions, and agents over time.

**Step 1: Import Chart component and build ECharts options**

Replace the SVG sparkline section (lines ~167-193) with a `<Chart>` component. Keep the 4 KPI cells above it but make them smaller/inline.

ECharts option structure:
```typescript
$derived(() => {
  const hbs = heartbeats.slice().reverse(); // chronological order
  const times = hbs.map(h => h.capturedAt);
  const memory = hbs.map(h => h.memoryRssMb ?? 0);
  const sessions = hbs.map(h => h.activeSessions);
  const agents = hbs.map(h => h.activeAgents);

  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Memory (MB)', 'Sessions', 'Agents'], top: 0 },
    grid: { top: 30, right: 50, bottom: 24, left: 50 },
    xAxis: {
      type: 'category',
      data: times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      axisLabel: { color: '#71717a', fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value',
        name: 'MB',
        position: 'left',
        axisLabel: { color: '#71717a', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      {
        type: 'value',
        name: 'Count',
        position: 'right',
        axisLabel: { color: '#71717a', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Memory (MB)',
        type: 'line',
        yAxisIndex: 0,
        data: memory,
        smooth: true,
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2 },
        itemStyle: { color: '#3b82f6' },
      },
      {
        name: 'Sessions',
        type: 'line',
        yAxisIndex: 1,
        data: sessions,
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: '#22c55e' },
      },
      {
        name: 'Agents',
        type: 'line',
        yAxisIndex: 1,
        data: agents,
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
  };
});
```

**Step 2: Replace the SVG block with `<Chart options={chartOptions} height="200px" />`**

**Step 3: Keep the uptime badge in the header area** (small pill showing formatted uptime from latest heartbeat)

**Step 4: Commit**

```bash
git add src/lib/components/reliability/GatewayHealthPanel.svelte
git commit -m "feat: replace SVG sparkline with ECharts multi-axis time series in gateway health"
```

### Task 2.3: Add channel status visualization

**Files:**
- Modify: `src/lib/components/reliability/GatewayHealthPanel.svelte`

**Context:** `channelStatusJson` from the latest heartbeat contains `{ channelAccounts: { [channelId]: { [accountId]: { enabled, configured, running, connected } } } }`. Render as a small status grid below the main chart.

**Step 1: Parse channelStatusJson from latest heartbeat**

```typescript
const channelStatus = $derived(() => {
  const latest = heartbeats[0];
  if (!latest?.channelStatusJson) return null;
  try {
    return JSON.parse(latest.channelStatusJson) as {
      channelAccounts: Record<string, Record<string, {
        enabled?: boolean;
        configured?: boolean;
        running?: boolean;
        connected?: boolean;
        reconnectAttempts?: number;
      }>>;
    };
  } catch { return null; }
});
```

**Step 2: Render channel status as colored dots per account**

Show each channel (Discord, Slack, etc.) with colored status indicators:
- Green dot: `running && connected`
- Yellow dot: `running && !connected`
- Red dot: `!running`
- Gray dot: `!enabled || !configured`

**Step 3: Commit**

```bash
git add src/lib/components/reliability/GatewayHealthPanel.svelte
git commit -m "feat: visualize channel status from heartbeat data"
```

---

## Phase 3: minion_hub — Credential Health Panel ECharts Upgrade

### Task 3.1: Add ECharts status distribution donut

**Files:**
- Modify: `src/lib/components/reliability/CredentialHealthPanel.svelte`

**Context:** Currently shows status badges + provider pill groups. Add an ECharts donut showing the distribution of statuses across all profiles.

**Step 1: Import Chart and compute donut options**

```typescript
import Chart from '$lib/components/Chart.svelte';

const statusColors: Record<string, string> = {
  ok: '#22c55e',
  expiring: '#f59e0b',
  expired: '#ef4444',
  static: '#64748b',
  missing: '#a855f7',
};

const donutOptions = $derived(() => {
  const profiles = state.parsed?.providers.flatMap(p => p.profiles) ?? [];
  const counts: Record<string, number> = {};
  for (const p of profiles) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
  }
  return {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['50%', '75%'],
      center: ['50%', '50%'],
      data: Object.entries(counts).map(([name, value]) => ({
        name, value,
        itemStyle: { color: statusColors[name] ?? '#64748b' },
      })),
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold' },
      },
    }],
  };
});
```

**Step 2: Layout — donut on the left, provider details on the right**

Use a two-column layout within the panel:
- Left: `<Chart options={donutOptions} height="180px" style="flex: 0 0 180px" />`
- Right: existing provider pill groups (condensed)

**Step 3: Commit**

```bash
git add src/lib/components/reliability/CredentialHealthPanel.svelte
git commit -m "feat: add ECharts status distribution donut to credential health panel"
```

### Task 3.2: Add credential expiration timeline

**Files:**
- Modify: `src/lib/components/reliability/CredentialHealthPanel.svelte`

**Context:** Profiles with `expiresAt` timestamps can be plotted on a scatter/bar timeline showing when credentials expire relative to now.

**Step 1: Build timeline chart options**

Only show profiles that have `expiresAt` set. X-axis is time, Y-axis is profile labels. Plot each as a colored marker (color = status).

```typescript
const timelineOptions = $derived(() => {
  const profiles = state.parsed?.providers.flatMap(p => p.profiles) ?? [];
  const expiring = profiles.filter(p => p.expiresAt);
  if (expiring.length === 0) return null;

  return {
    tooltip: { trigger: 'item' },
    grid: { top: 10, right: 20, bottom: 30, left: 100 },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#71717a', fontSize: 10 },
    },
    yAxis: {
      type: 'category',
      data: expiring.map(p => `${p.provider}/${p.profileId}`),
      axisLabel: { color: '#71717a', fontSize: 10 },
    },
    series: [{
      type: 'scatter',
      symbolSize: 14,
      data: expiring.map((p, i) => ({
        value: [p.expiresAt, i],
        itemStyle: { color: statusColors[p.status] ?? '#64748b' },
      })),
    }],
    // Add markLine for "now"
    // series[0].markLine = { data: [{ xAxis: Date.now() }], lineStyle: { color: '#ef4444' } }
  };
});
```

**Step 2: Render conditionally** — only show if `timelineOptions` is not null

**Step 3: Commit**

```bash
git add src/lib/components/reliability/CredentialHealthPanel.svelte
git commit -m "feat: add credential expiration timeline chart"
```

---

## Phase 4: minion_hub — Skill Stats Panel ECharts Upgrade

### Task 4.1: Replace HTML stacked bars with ECharts horizontal bar

**Files:**
- Modify: `src/lib/components/reliability/SkillStatsPanel.svelte`

**Context:** Currently uses HTML divs for stacked bars. Replace with an ECharts horizontal stacked bar chart. Skills on Y-axis, execution counts on X-axis, bars colored by status.

**Step 1: Import Chart and build bar chart options**

```typescript
import Chart from '$lib/components/Chart.svelte';

const statusColors: Record<string, string> = {
  ok: '#22c55e',
  error: '#ef4444',
  auth_error: '#f59e0b',
  timeout: '#a855f7',
};

const barOptions = $derived(() => {
  const skills = state.aggregated; // SkillAggregate[]
  if (!skills.length) return null;

  const skillNames = skills.map(s => s.skillName);
  const statuses = ['ok', 'error', 'auth_error', 'timeout'] as const;

  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: statuses, top: 0 },
    grid: { top: 30, right: 20, bottom: 10, left: 120, containLabel: false },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: skillNames,
      axisLabel: { color: '#71717a', fontSize: 10, width: 110, overflow: 'truncate' },
      inverse: true,
    },
    series: statuses.map(status => ({
      name: status,
      type: 'bar',
      stack: 'total',
      data: skills.map(s => s.byStatus[status] ?? 0),
      itemStyle: { color: statusColors[status] },
      barMaxWidth: 20,
    })),
  };
});
```

**Step 2: Replace the HTML bars with `<Chart options={barOptions} height={`${Math.max(200, skills.length * 32)}px`} />`**

**Step 3: Keep the avg duration display** — show as a secondary annotation or in tooltip

**Step 4: Commit**

```bash
git add src/lib/components/reliability/SkillStatsPanel.svelte
git commit -m "feat: replace HTML stacked bars with ECharts horizontal bar in skill stats"
```

### Task 4.2: Add duration overlay line

**Files:**
- Modify: `src/lib/components/reliability/SkillStatsPanel.svelte`

**Step 1: Add a secondary x-axis for duration**

Add a line series overlay showing `avgDurationMs` per skill on a right-aligned axis:

```typescript
// Add to the options object:
xAxis: [
  { type: 'value', name: 'Count' },
  { type: 'value', name: 'Avg Duration (ms)', position: 'top', axisLabel: { color: '#71717a' } },
],
// Add duration series:
{
  name: 'Avg Duration',
  type: 'line',
  xAxisIndex: 1,
  data: skills.map(s => s.avgDurationMs),
  lineStyle: { color: '#06b6d4', width: 2, type: 'dashed' },
  itemStyle: { color: '#06b6d4' },
  symbol: 'circle',
  symbolSize: 6,
}
```

**Step 2: Commit**

```bash
git add src/lib/components/reliability/SkillStatsPanel.svelte
git commit -m "feat: add avg duration overlay to skill stats chart"
```

---

## Phase 5: minion_hub — Connection Events Panel (NEW)

### Task 5.1: Create API endpoint for connection events

**Files:**
- Create: `src/routes/api/metrics/connection-events/+server.ts`

**Context:** The `connection_events` table and `listConnectionEvents()` service function already exist but no API endpoint exposes them. The service is at `src/server/services/connection.service.ts`.

**Step 1: Create the GET endpoint**

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConnectionEvents } from '$server/services/connection.service';
// Use the same tenant context pattern as other metrics endpoints

export const GET: RequestHandler = async ({ url, locals }) => {
  const ctx = /* tenant context resolution, same pattern as gateway-heartbeats */;
  const serverId = url.searchParams.get('serverId');
  if (!ctx || !serverId) return json({ events: [] });

  const limit = parseInt(url.searchParams.get('limit') ?? '100');
  const events = await listConnectionEvents(ctx, serverId, limit);
  return json({ events });
};
```

**Step 2: Commit**

```bash
git add src/routes/api/metrics/connection-events/+server.ts
git commit -m "feat: add GET /api/metrics/connection-events endpoint"
```

### Task 5.2: Create ConnectionEventsPanel component

**Files:**
- Create: `src/lib/components/reliability/ConnectionEventsPanel.svelte`

**Context:** Visualize connection/disconnect events as a timeline. The `connection_events` schema has: `eventType`, `hostName`, `hostUrl`, `durationMs`, `reason`, `occurredAt`.

**Step 1: Create the component**

- Fetch from `/api/metrics/connection-events?serverId=X&limit=50`
- Build an ECharts scatter/timeline chart:
  - X-axis: time
  - Y-axis: event type (connect/disconnect)
  - Color by event type (green for connect, red for disconnect)
  - Tooltip shows hostName, reason, duration
- Use the standard card wrapper pattern (icon + uppercase title + ScanLine)

**Step 2: Commit**

```bash
git add src/lib/components/reliability/ConnectionEventsPanel.svelte
git commit -m "feat: add ConnectionEventsPanel with timeline visualization"
```

### Task 5.3: Add panel to reliability page

**Files:**
- Modify: `src/routes/reliability/+page.svelte`

**Step 1: Import and add to the grid**

The health panels grid (line ~362) currently uses `grid-cols-3`. Either:
- Expand to `grid-cols-4` (if connection events panel fits alongside the others)
- Or add a new full-width row below the existing panels for connection events

Recommended: Keep `grid-cols-3` for the existing panels, add connection events as a full-width panel below them (it benefits from more horizontal space for the timeline).

**Step 2: Commit**

```bash
git add src/routes/reliability/+page.svelte
git commit -m "feat: add connection events panel to reliability dashboard"
```

---

## Phase 6: minion_hub — Event Metadata Drill-Down

### Task 6.1: Add expandable metadata to incident table

**Files:**
- Find and modify the incident table component (rendered in `src/routes/reliability/+page.svelte`, likely an inline table or a sub-component)

**Context:** Reliability events have a `metadata` JSON field containing rich context: cron `durationMs`/`jobId`, browser `path`/`statusCode`, auth `profileId`/`provider`. Currently not displayed.

**Step 1: Add expandable row**

- Each row gets a chevron/expand toggle
- On expand, parse and display `metadata` as a formatted key-value list
- Highlight special keys:
  - `durationMs` → formatted as "123ms"
  - `profileId`/`provider` → styled as pills
  - `statusCode` → colored (green for 2xx, red for 4xx/5xx)
  - `error` → displayed in a code block
  - `jobId` → monospace

**Step 2: Commit**

```bash
git add src/routes/reliability/+page.svelte  # or the table component file
git commit -m "feat: add expandable metadata drill-down to incident table"
```

---

## Phase 7: minion_hub — Layout & Polish

### Task 7.1: Adjust page grid for new panels

**Files:**
- Modify: `src/routes/reliability/+page.svelte`

**Step 1: Restructure the health panels section**

New layout order (top to bottom):
1. Overview stats (6 KPI cards) — existing
2. Event Timeline (stacked area) — existing
3. Two-column: Top Events + Severity Distribution — existing
4. **Three-column health panels**: Gateway Health | Credential Health | Skill Stats — upgraded
5. **Full-width**: Connection Events timeline — new
6. Incident Table with metadata drill-down — enhanced

**Step 2: Ensure responsive breakpoints**

- `grid-cols-3` → `grid-cols-1` at 900px for health panels (existing)
- Connection events panel: full-width at all breakpoints
- Chart heights should be responsive (min 200px)

**Step 3: Commit**

```bash
git add src/routes/reliability/+page.svelte
git commit -m "feat: restructure reliability page layout with new panels"
```

### Task 7.2: Add "builtin:" prefix handling in skill stats display

**Files:**
- Modify: `src/lib/components/reliability/SkillStatsPanel.svelte`

**Context:** Built-in tools will now appear as `"builtin:browser"`, `"builtin:web_fetch"` etc. in skill stats. The panel should display these nicely.

**Step 1: Format skill names**

```typescript
function formatSkillName(name: string): string {
  if (name.startsWith('builtin:')) {
    return name.slice(8).replace(/_/g, ' ');  // "browser", "web fetch", etc.
  }
  return name;
}
```

**Step 2: Add a visual indicator** — small badge or icon distinguishing built-in tools from plugin skills

**Step 3: Commit**

```bash
git add src/lib/components/reliability/SkillStatsPanel.svelte
git commit -m "feat: format builtin tool names in skill stats display"
```

---

## Execution Order & Dependencies

```
Phase 1 (openclaw) ──────────────────────────────────────────────────
  Task 1.1: wrapToolWithTracking utility
  Task 1.2: Apply to 5 built-in tools (depends on 1.1)
  Task 1.3: Enrich heartbeat with channelStatusJson

Phase 2 (hub) ── can start in parallel with Phase 1 ────────────────
  Task 2.1: Extend Heartbeat interface
  Task 2.2: ECharts multi-axis chart (depends on 2.1)
  Task 2.3: Channel status viz (depends on 2.1, benefits from 1.3)

Phase 3 (hub) ── can start in parallel with Phase 2 ────────────────
  Task 3.1: Credential donut chart
  Task 3.2: Expiration timeline (depends on 3.1)

Phase 4 (hub) ── can start in parallel with Phase 2 & 3 ───────────
  Task 4.1: ECharts horizontal bar
  Task 4.2: Duration overlay (depends on 4.1)

Phase 5 (hub) ── can start in parallel ─────────────────────────────
  Task 5.1: Connection events API endpoint
  Task 5.2: ConnectionEventsPanel component (depends on 5.1)
  Task 5.3: Add to page (depends on 5.2)

Phase 6 (hub) ── can start in parallel ─────────────────────────────
  Task 6.1: Metadata drill-down in incident table

Phase 7 (hub) ── after all other phases ────────────────────────────
  Task 7.1: Final layout adjustment
  Task 7.2: Builtin prefix formatting (depends on Phase 1 deploy)
```

**Parallelization:** Phases 2, 3, 4, 5, 6 are all independent and can be worked on simultaneously. Phase 1 (openclaw) is independent of all hub phases. Phase 7 is the final polish pass.

---

## Testing Strategy

- **Phase 1:** Deploy openclaw to protopi, verify skill stats appear in hub for browser/memory/web-fetch tool calls
- **Phases 2-6:** Visual verification via `bun run dev` — each panel should render with the ECharts charts
- **Phase 7:** Full page visual review, check responsive breakpoints at 900px and 600px
- **Data:** If no real heartbeat data, seed test data via the POST endpoints or use the existing data from protopi
