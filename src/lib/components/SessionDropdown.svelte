<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { Session } from '$lib/types/gateway';
  import * as combobox from '@zag-js/combobox';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  let { agentId, serverId }: { agentId: string; serverId: string | null } = $props();

  // ── Session item type for the combobox collection ───────────────────────
  type SessionItem = {
    sessionKey: string;
    displayName: string;
    relTime: string;
    statusColor: string;
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  function truncKey(sk?: string) {
    if (!sk) return '\u2014';
    const parts = sk.split(':');
    return parts.length > 2 ? parts.slice(2).join(':').slice(0, 16) : sk.slice(0, 16);
  }

  function relativeTime(ts?: number): string {
    if (!ts) return '';
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return 'now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function statusColor(sk: string): string {
    const s = ui.sessionStatus[sk];
    switch (s) {
      case 'running': return 'bg-green-400';
      case 'thinking': return 'bg-yellow-400';
      case 'idle': return 'bg-zinc-500';
      case 'aborted': return 'bg-red-400';
      default: return 'bg-zinc-600';
    }
  }

  // ── Main session key ──────────────────────────────────────────────────
  const mainSessionKey = $derived(`agent:${agentId}:main`);
  const isMainSession = $derived(ui.selectedSessionKey === mainSessionKey);

  function backToMain() {
    ui.selectedSessionKey = mainSessionKey;
    api.setValue([mainSessionKey]);
  }

  // ── Filtered sessions for this agent ────────────────────────────────────
  const agentSessions = $derived(
    gw.sessions.filter((s: Session) => {
      const sk = s.sessionKey ?? '';
      return sk.includes(`agent:${agentId}:`);
    })
  );

  // ── Build SessionItem list ──────────────────────────────────────────────
  const sessionItems = $derived<SessionItem[]>(
    agentSessions.map((s: Session) => ({
      sessionKey: s.sessionKey,
      displayName: s.displayName || s.label || truncKey(s.sessionKey),
      relTime: relativeTime(s.updatedAt ?? s.lastActiveAt ?? s.createdAt),
      statusColor: statusColor(s.sessionKey),
    }))
  );

  // ── Fuzzy filtering ────────────────────────────────────────────────────
  let filterQuery = $state('');

  const filteredItems = $derived<SessionItem[]>(
    filterQuery.trim()
      ? sessionItems.filter((item) => {
          const q = filterQuery.toLowerCase();
          return (
            item.displayName.toLowerCase().includes(q) ||
            item.sessionKey.toLowerCase().includes(q)
          );
        })
      : sessionItems
  );

  // ── Zag.js combobox ────────────────────────────────────────────────────
  const sessionCollection = $derived(
    combobox.collection({
      items: filteredItems,
      itemToValue: (item: SessionItem) => item.sessionKey,
      itemToString: (item: SessionItem) => item.displayName,
    })
  );

  const comboboxService = useMachine(combobox.machine, () => ({
    id: 'session-combobox',
    collection: sessionCollection,
    placeholder: 'Search sessions\u2026',
    selectionBehavior: 'replace' as const,
    openOnClick: true,
    openOnChange: true,
    positioning: { placement: 'bottom-start' as const },
    onInputValueChange({ inputValue }: { inputValue: string }) {
      filterQuery = inputValue;
    },
    onValueChange({ value }: { value: string[] }) {
      const sk = value[0] ?? null;
      ui.selectedSessionKey = sk;
    },
  }));

  const api = $derived(combobox.connect(comboboxService, normalizeProps));

  // ── Auto-select first session ──────────────────────────────────────────
  $effect(() => {
    if (!ui.selectedSessionKey && agentSessions.length > 0) {
      const first = agentSessions[0].sessionKey ?? null;
      ui.selectedSessionKey = first;
      if (first) {
        api.setValue([first]);
      }
    }
  });

  // ── Sync external selection into combobox ──────────────────────────────
  $effect(() => {
    const sk = ui.selectedSessionKey;
    if (sk && api.value[0] !== sk) {
      api.setValue([sk]);
    }
  });
</script>

<div class="shrink-0 px-5 py-1.5 border-b border-border bg-bg2">
  <div {...api.getRootProps()}>
    <div class="flex items-center gap-2">
      <label
        class="text-[10px] font-bold uppercase tracking-[0.6px] text-muted-foreground shrink-0"
        {...api.getLabelProps()}
      >Session</label>

      <div
        class="flex flex-1 min-w-0 items-center bg-bg3 border border-border rounded-[4px] transition-all focus-within:border-accent"
        {...api.getControlProps()}
      >
        <input
          class="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground text-[11px] font-mono px-1.5 py-[3px] placeholder:text-muted-foreground"
          {...api.getInputProps()}
        />
        <button
          class="bg-transparent border-none text-muted-foreground cursor-pointer text-sm px-1 py-0 leading-none shrink-0 transition-colors hover:text-foreground data-[state=hidden]:hidden"
          aria-label="Clear session"
          tabindex="-1"
          {...api.getClearTriggerProps()}
        >&times;</button>
        <button
          class="bg-transparent border-none text-muted-foreground cursor-pointer text-[10px] pr-1.5 pl-[2px] py-0 leading-none shrink-0 transition-colors hover:text-muted"
          tabindex="-1"
          aria-label="Toggle session list"
          {...api.getTriggerProps()}
        >&#9662;</button>
      </div>

      <span class="text-[10px] text-muted-foreground opacity-65 shrink-0">{agentSessions.length}</span>

      {#if !isMainSession}
        <button
          class="shrink-0 text-[10px] font-semibold text-accent bg-accent/12 rounded-full px-2 py-[2px] transition-colors hover:bg-accent/20"
          onclick={backToMain}
        >Back to main</button>
      {/if}
    </div>

    <!-- Dropdown positioner (always in DOM, hidden via data-state) -->
    <div class="z-2000 data-[state=closed]:hidden" {...api.getPositionerProps()}>
      <div
        class="bg-bg2 border border-border rounded-md shadow-md overflow-hidden min-w-[200px]"
        {...api.getContentProps()}
      >
        <ul class="list-none m-0 p-1 max-h-[220px] overflow-y-auto" {...api.getListProps()}>
          {#each filteredItems as item (item.sessionKey)}
            <li
              class="group flex items-center gap-[6px] py-[5px] px-2 rounded-sm text-xs cursor-pointer transition-colors data-[highlighted]:bg-bg3"
              {...api.getItemProps({ item })}
            >
              <!-- Status dot -->
              <span class="shrink-0 w-[6px] h-[6px] rounded-full {item.statusColor}"></span>
              <!-- Display name -->
              <span
                class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] group-data-[selected]:text-accent group-data-[selected]:font-semibold"
                {...api.getItemTextProps({ item })}
              >{item.displayName}</span>
              <!-- Relative time -->
              {#if item.relTime}
                <span class="text-[10px] text-muted-foreground shrink-0">{item.relTime}</span>
              {/if}
            </li>
          {/each}
          {#if filteredItems.length === 0}
            <li class="p-2 text-muted-foreground text-xs italic">No matching sessions</li>
          {/if}
        </ul>
      </div>
    </div>
  </div>
</div>
