<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';

  export type SessionRow = {
    id: string;
    serverId: string;
    agentId: string;
    sessionKey: string;
    status: string;
    metadata: string | null;
    createdAt: number;
    updatedAt: number;
  };

  let {
    sessions,
    selectedKey,
    onSelect,
  }: {
    sessions: SessionRow[];
    selectedKey: string | null;
    onSelect: (sessionKey: string) => void;
  } = $props();

  let search = $state('');
  let agentFilter = $state('');

  function parseMeta(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }

  function getDisplayName(s: SessionRow): string {
    const m = parseMeta(s.metadata);
    const label = typeof m.label === 'string' ? m.label : null;
    const display = typeof m.displayName === 'string' ? m.displayName : null;
    return display ?? label ?? s.sessionKey;
  }

  function relTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function statusColor(status: string): string {
    if (status === 'running' || status === 'thinking') return 'green';
    if (status === 'idle') return 'amber';
    return 'grey';
  }

  const uniqueAgents = $derived([...new Set(sessions.map((s) => s.agentId))].sort());

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (agentFilter && s.agentId !== agentFilter) return false;
      if (!q) return true;
      const m = parseMeta(s.metadata);
      const label = typeof m.label === 'string' ? m.label : '';
      const display = typeof m.displayName === 'string' ? m.displayName : '';
      return (
        s.sessionKey.toLowerCase().includes(q) ||
        s.agentId.toLowerCase().includes(q) ||
        label.toLowerCase().includes(q) ||
        display.toLowerCase().includes(q)
      );
    });
  });

  const multiAgent = $derived(uniqueAgents.length > 1);

  // Group filtered sessions by agentId
  const grouped = $derived.by(() => {
    const map = new SvelteMap<string, SessionRow[]>();
    for (const s of filtered) {
      const list = map.get(s.agentId) ?? [];
      list.push(s);
      map.set(s.agentId, list);
    }
    return map;
  });
</script>

<div class="sessions-list">
  <div class="list-header">
    <input
      class="search-input"
      type="search"
      placeholder="Search sessions…"
      bind:value={search}
    />
    {#if uniqueAgents.length > 1}
      <select class="agent-select" bind:value={agentFilter}>
        <option value="">All agents</option>
        {#each uniqueAgents as aid (aid)}
          <option value={aid}>{aid}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="list-body">
    {#if filtered.length === 0}
      <div class="empty">No sessions found.</div>
    {:else if multiAgent}
      {#each [...grouped.entries()] as [agentId, rows] (agentId)}
        <div class="agent-group">
          <div class="group-header">{agentId}</div>
          {#each rows as s (s.sessionKey)}
            {@const color = statusColor(s.status)}
            <button
              class="session-row {selectedKey === s.sessionKey ? 'selected' : ''}"
              onclick={() => onSelect(s.sessionKey)}
            >
              <div class="row-main">
                <span class="session-name">{getDisplayName(s)}</span>
                <span class="status-badge {color}"></span>
              </div>
              <div class="row-meta">
                <span class="session-key">{s.sessionKey}</span>
                <span class="rel-time">{relTime(s.updatedAt)}</span>
              </div>
            </button>
          {/each}
        </div>
      {/each}
    {:else}
      {#each filtered as s (s.sessionKey)}
        {@const color = statusColor(s.status)}
        <button
          class="session-row {selectedKey === s.sessionKey ? 'selected' : ''}"
          onclick={() => onSelect(s.sessionKey)}
        >
          <div class="row-main">
            <span class="session-name">{getDisplayName(s)}</span>
            <span class="status-badge {color}"></span>
          </div>
          <div class="row-meta">
            <span class="agent-chip">{s.agentId}</span>
            <span class="rel-time">{relTime(s.updatedAt)}</span>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .sessions-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .list-header {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 10px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--text2); }

  .agent-select {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 5px 8px;
    font-family: inherit;
    font-size: 11px;
    outline: none;
    cursor: pointer;
  }
  .agent-select:focus { border-color: var(--accent); }

  .list-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .empty {
    color: var(--text2);
    font-size: 12px;
    text-align: center;
    padding: 24px 16px;
  }

  .agent-group {
    display: flex;
    flex-direction: column;
  }

  .group-header {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text2);
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .session-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 9px 12px;
    background: none;
    border: none;
    border-bottom: 1px solid rgba(42, 53, 72, 0.4);
    border-left: 3px solid transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .session-row:hover { background: rgba(255, 255, 255, 0.03); }
  .session-row.selected {
    background: var(--bg3);
    border-left-color: var(--accent);
  }

  .row-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .session-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .status-badge {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .status-badge.green  { background: var(--green); box-shadow: 0 0 5px var(--green); }
  .status-badge.amber  { background: var(--amber); }
  .status-badge.grey   { background: #475569; }

  .row-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .session-key {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--text2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .agent-chip {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    background: rgba(99, 102, 241, 0.12);
    border-radius: 10px;
    padding: 1px 7px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .rel-time {
    font-size: 10px;
    color: var(--text2);
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
