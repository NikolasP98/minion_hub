<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { createHotkey } from '$lib/hotkeys';
  import { browser } from '$app/environment';
  import { createVirtualizer } from '$lib/virtual/virtualizer.svelte';

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
  let searchEl: HTMLInputElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();

  // Bare `/` is input-safe by lib default (won't fire while typing elsewhere).
  createHotkey('/', () => searchEl?.focus(), {
    meta: { name: m.shortcuts_gridSearch() },
  });

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

  // Flatten grouped/ungrouped branches into one virtualizable list.
  // ponytail: dropping sticky group headers here — they scroll with content now;
  // rangeExtractor pinning wasn't trivial enough to justify for a session list.
  type ListItem = { kind: 'header'; agentId: string } | { kind: 'session'; s: SessionRow };
  const items = $derived.by((): ListItem[] => {
    if (!multiAgent) return filtered.map((s) => ({ kind: 'session', s }));
    const out: ListItem[] = [];
    for (const [agentId, rows] of grouped) {
      out.push({ kind: 'header', agentId });
      for (const s of rows) out.push({ kind: 'session', s });
    }
    return out;
  });

  function itemKey(item: ListItem): string {
    return item.kind === 'header' ? `header:${item.agentId}` : `session:${item.s.sessionKey}`;
  }

  const v = $derived(
    browser && scrollEl
      ? createVirtualizer({
          count: items.length,
          getScrollElement: () => scrollEl ?? null,
          getItemKey: (i) => itemKey(items[i]),
          estimateSize: (i) => (items[i]?.kind === 'header' ? 28 : 44),
          overscan: 8,
        })
      : null,
  );

  // Reset scroll to top when the view identity changes (search/agent filter).
  $effect(() => {
    void search;
    void agentFilter;
    v?.scrollToOffset(0);
  });
</script>

<div class="flex flex-col h-full overflow-hidden bg-bg">
  <div class="shrink-0 flex flex-col gap-1.5 p-2.5 px-3 border-b border-border">
    <input
      bind:this={searchEl}
      class="w-full box-border bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 font-inherit text-xs outline-none focus:border-accent placeholder:text-muted"
      type="search"
      placeholder={m.sessions_searchPlaceholder()}
      bind:value={search}
    />
    {#if uniqueAgents.length > 1}
      <select class="w-full box-border bg-bg2 border border-border rounded-md text-foreground px-2 py-[5px] font-inherit text-[11px] outline-none cursor-pointer focus:border-accent" bind:value={agentFilter}>
        <option value="">{m.sessions_allAgents()}</option>
        {#each uniqueAgents as aid (aid)}
          <option value={aid}>{aid}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-color-border" bind:this={scrollEl}>
    {#if filtered.length === 0}
      <div class="text-muted text-xs text-center py-6 px-4">{m.sessions_noSessions()}</div>
    {:else if v}
      <div class="relative w-full" style="height:{v.getTotalSize()}px">
        {#each v.getVirtualItems() as item (item.key)}
          {@const row = items[item.index]}
          <div
            data-index={item.index}
            {@attach (node) => v.measureElement(node)}
            class="absolute left-0 right-0"
            style="transform: translateY({item.start}px)"
          >
            {#if row.kind === 'header'}
              <div class="text-[10px] font-bold tracking-[0.08em] uppercase text-muted py-2 px-3 pb-1 border-b border-border bg-bg2">{row.agentId}</div>
            {:else}
              {@const s = row.s}
              {@const color = statusColor(s.status)}
              <button
                class="flex flex-col gap-[3px] w-full py-[9px] px-3 bg-transparent border-0 border-b border-b-white/[0.04] border-l-3 border-l-transparent text-foreground cursor-pointer text-left transition-colors duration-100 hover:bg-white/[0.03] {selectedKey === s.sessionKey ? '!bg-bg3 !border-l-accent' : ''}"
                onclick={() => onSelect(s.sessionKey)}
              >
                <div class="flex items-center justify-between gap-1.5">
                  <span class="text-xs font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{getDisplayName(s)}</span>
                  <span
                    class="shrink-0 w-2 h-2 rounded-full
                      {color === 'green' ? 'bg-success shadow-[0_0_5px_var(--color-success)]' : ''}
                      {color === 'amber' ? 'bg-warning' : ''}
                      {color === 'grey'  ? 'bg-[#475569]' : ''}"
                  ></span>
                </div>
                {#if multiAgent}
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="font-mono text-[10px] text-muted overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{s.sessionKey}</span>
                    <span class="text-[10px] text-muted whitespace-nowrap shrink-0">{relTime(s.updatedAt)}</span>
                  </div>
                {:else}
                  <div class="flex items-center justify-between gap-1.5">
                    <span class="text-[10px] font-semibold text-accent bg-accent/12 rounded-[10px] px-[7px] py-[1px] whitespace-nowrap shrink-0">{s.agentId}</span>
                    <span class="text-[10px] text-muted whitespace-nowrap shrink-0">{relTime(s.updatedAt)}</span>
                  </div>
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
