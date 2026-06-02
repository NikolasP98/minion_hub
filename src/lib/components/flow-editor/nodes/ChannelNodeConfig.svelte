<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ChannelNodeData, ChannelDestination } from '$lib/state/features/flow-editor.svelte';
  import { conn } from '$lib/state/gateway';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Plus, Trash2, User, Pencil } from 'lucide-svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as ChannelNodeData);
  const destinations = $derived(Array.isArray(data.destinations) ? data.destinations : []);

  // ── Channel list (from the gateway's channel plugins) ───────────────────────
  type ChannelItem = { id: string; label: string };
  const FALLBACK_CHANNELS: ChannelItem[] = [
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'discord', label: 'Discord' },
  ];
  let channels = $state<ChannelItem[]>(FALLBACK_CHANNELS);

  $effect(() => {
    if (!conn.connected) return;
    void (async () => {
      try {
        const res = (await sendRequest('channels.plugins.list', {})) as
          | { plugins?: { channelType?: string; pluginId?: string; label?: string }[] }
          | null;
        const items = (res?.plugins ?? [])
          .map((p) => ({ id: p.channelType ?? p.pluginId ?? '', label: p.label ?? p.channelType ?? p.pluginId ?? '' }))
          .filter((c) => c.id);
        if (items.length > 0) channels = items;
      } catch {
        // keep fallback list
      }
    })();
  });

  // ── Per-channel address hints (Custom mode) ─────────────────────────────────
  const HINTS: Record<string, { placeholder: string; hint: string }> = {
    whatsapp: { placeholder: '+51922286663', hint: 'Phone number in E.164 (with +country code) or WhatsApp JID' },
    telegram: { placeholder: '123456789', hint: 'Numeric chat ID (or @username)' },
    discord: { placeholder: '123456789012345678', hint: 'User ID or channel ID (snowflake)' },
  };
  const hint = $derived(HINTS[data.channel] ?? { placeholder: 'destination id', hint: 'Channel-specific address' });

  // ── Registered directory (the "by user" picker source) ──────────────────────
  type DirEntry = { id: string; name?: string; handle?: string; kind?: string };
  let dirEntries = $state<DirEntry[]>([]);
  let dirStatus = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  let dirForChannel = $state<string>('');

  // (Re)load the registered directory whenever the channel changes and at least
  // one destination is in "user" mode. Degrades gracefully: an older gateway
  // without `channels.directory.list` just leaves the picker empty + a note.
  $effect(() => {
    const needsDir = destinations.some((d) => d.kind === 'user');
    if (!conn.connected || !data.channel || !needsDir) return;
    if (dirForChannel === data.channel && dirStatus !== 'idle') return;
    dirForChannel = data.channel;
    dirStatus = 'loading';
    void (async () => {
      try {
        const res = (await sendRequest('channels.directory.list', { channel: data.channel, limit: 200 })) as
          | { entries?: DirEntry[] }
          | null;
        dirEntries = res?.entries ?? [];
        dirStatus = 'ready';
      } catch {
        dirEntries = [];
        dirStatus = 'unavailable';
      }
    })();
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  function setChannel(channel: string) {
    updateNodeData(nodeId, { channel });
  }
  function setAccount(accountId: string) {
    updateNodeData(nodeId, { accountId: accountId.trim() || undefined });
  }
  function patchDest(i: number, patch: Partial<ChannelDestination>) {
    const next = destinations.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
    updateNodeData(nodeId, { destinations: next });
  }
  function addDest() {
    updateNodeData(nodeId, { destinations: [...destinations, { kind: 'custom', to: '' } as ChannelDestination] });
  }
  function removeDest(i: number) {
    updateNodeData(nodeId, { destinations: destinations.filter((_, idx) => idx !== i) });
  }
  function pickUser(i: number, value: string) {
    const entry = dirEntries.find((e) => e.id === value);
    patchDest(i, { to: value, label: entry?.name ?? entry?.handle ?? value });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <!-- Channel selector -->
  <div class="flex flex-col gap-1">
    <label for="ch-channel" class="text-[11px] font-medium text-foreground">Channel</label>
    <select
      id="ch-channel"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground capitalize"
      value={data.channel ?? ''}
      onchange={(e) => setChannel((e.target as HTMLSelectElement).value)}
    >
      <option value="" disabled>Select a channel…</option>
      {#each channels as c (c.id)}
        <option value={c.id}>{c.label}</option>
      {/each}
      {#if data.channel && !channels.some((c) => c.id === data.channel)}
        <option value={data.channel}>{data.channel}</option>
      {/if}
    </select>
  </div>

  <!-- Optional sending account -->
  <div class="flex flex-col gap-1">
    <label for="ch-account" class="text-[11px] font-medium text-foreground">Account <span class="text-muted font-normal">(optional)</span></label>
    <input
      id="ch-account"
      type="text"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder="default account"
      value={data.accountId ?? ''}
      oninput={(e) => setAccount((e.target as HTMLInputElement).value)}
    />
  </div>

  <!-- Destinations -->
  <div class="flex items-center justify-between pt-1">
    <span class="text-[11px] font-semibold text-foreground">Destinations</span>
    <button
      class="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
      onclick={addDest}
      disabled={!data.channel}
      title={data.channel ? 'Add a destination' : 'Pick a channel first'}
    >
      <Plus size={12} /> Add
    </button>
  </div>

  {#if !data.channel}
    <p class="text-[10px] text-muted">Choose a channel to add destinations.</p>
  {:else if destinations.length === 0}
    <p class="text-[10px] text-muted">No destinations yet — click <span class="text-foreground">Add</span>.</p>
  {/if}

  <div class="flex flex-col gap-2">
    {#each destinations as d, i (i)}
      <div class="border border-border rounded-lg p-2 flex flex-col gap-1.5 bg-bg3/40">
        <div class="flex items-center justify-between">
          <!-- Mode toggle: registered user vs custom -->
          <div class="flex items-center rounded-md bg-bg3 border border-border overflow-hidden">
            <button
              class="flex items-center gap-1 px-2 py-0.5 text-[10px] {d.kind === 'user' ? 'bg-cyan-500/25 text-cyan-200' : 'text-muted hover:text-foreground'}"
              onclick={() => patchDest(i, { kind: 'user', to: '' })}
              title="Pick a user registered with this channel"
            >
              <User size={10} /> Registered
            </button>
            <button
              class="flex items-center gap-1 px-2 py-0.5 text-[10px] {d.kind === 'custom' ? 'bg-cyan-500/25 text-cyan-200' : 'text-muted hover:text-foreground'}"
              onclick={() => patchDest(i, { kind: 'custom' })}
              title="Enter an address manually"
            >
              <Pencil size={10} /> Custom
            </button>
          </div>
          <button
            class="text-muted/60 hover:text-red-400 transition-colors"
            onclick={() => removeDest(i)}
            title="Remove destination"
            aria-label="Remove destination"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {#if d.kind === 'user'}
          {#if dirStatus === 'loading'}
            <p class="text-[10px] text-muted">Loading contacts…</p>
          {:else if dirStatus === 'unavailable' || dirEntries.length === 0}
            <p class="text-[10px] text-amber-400/80 leading-snug">
              No registered contacts available for {data.channel}. Switch to <span class="text-foreground">Custom</span> to enter an address.
            </p>
          {:else}
            <select
              class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
              value={d.to}
              onchange={(e) => pickUser(i, (e.target as HTMLSelectElement).value)}
            >
              <option value="" disabled>Select a contact…</option>
              {#each dirEntries as e (e.id)}
                <option value={e.id}>{e.name ?? e.handle ?? e.id}{e.kind && e.kind !== 'user' ? ` (${e.kind})` : ''}</option>
              {/each}
            </select>
          {/if}
        {:else}
          <input
            type="text"
            class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
            placeholder={hint.placeholder}
            value={d.to}
            oninput={(e) => patchDest(i, { to: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            class="w-full text-[11px] bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            placeholder="label (optional)"
            value={d.label ?? ''}
            oninput={(e) => patchDest(i, { label: (e.target as HTMLInputElement).value || undefined })}
          />
          <p class="text-[10px] text-muted leading-snug">{hint.hint}</p>
        {/if}
      </div>
    {/each}
  </div>
</div>
