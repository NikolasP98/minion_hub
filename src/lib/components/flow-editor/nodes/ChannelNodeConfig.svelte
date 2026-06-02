<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ChannelNodeData, ChannelDestination } from '$lib/state/features/flow-editor.svelte';
  import { conn } from '$lib/state/gateway';
  import {
    channelPlugins,
    ensureChannelPlugins,
    ensureChannelStatus,
    ensureRegisteredIdentities,
    accountsFor,
    identitiesFor,
  } from '$lib/state/features/channel-sources.svelte';
  import { Plus, Trash2, User, Pencil } from 'lucide-svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as ChannelNodeData);
  const destinations = $derived(Array.isArray(data.destinations) ? data.destinations : []);

  const channels = $derived(channelPlugins());
  const accounts = $derived(accountsFor(data.channel));
  const registered = $derived(identitiesFor(data.channel));

  $effect(() => {
    if (!conn.connected) return;
    void ensureChannelPlugins();
    void ensureChannelStatus();
  });
  // Registered identities come from the hub DB (not the gateway) — load once.
  $effect(() => {
    void ensureRegisteredIdentities();
  });

  // ── Per-channel address hints (Custom mode) ─────────────────────────────────
  const HINTS: Record<string, { placeholder: string; hint: string }> = {
    whatsapp: { placeholder: '+51922286663', hint: 'Phone number in E.164 (with +country code) or WhatsApp JID' },
    telegram: { placeholder: '123456789', hint: 'Numeric chat ID (or @username)' },
    discord: { placeholder: '123456789012345678', hint: 'User ID or channel ID (snowflake)' },
  };
  const hint = $derived(HINTS[data.channel] ?? { placeholder: 'destination id', hint: 'Channel-specific address' });

  // ── Mutations ───────────────────────────────────────────────────────────────
  function setChannel(channel: string) {
    // Reset account + registered destinations: they're channel-specific.
    updateNodeData(nodeId, {
      channel,
      accountId: undefined,
      destinations: destinations.map((d) => (d.kind === 'user' ? { ...d, to: '', label: undefined } : d)),
    });
  }
  function setAccount(accountId: string) {
    updateNodeData(nodeId, { accountId: accountId || undefined });
  }
  function patchDest(i: number, patch: Partial<ChannelDestination>) {
    updateNodeData(nodeId, { destinations: destinations.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  }
  function addDest() {
    updateNodeData(nodeId, { destinations: [...destinations, { kind: 'custom', to: '' } as ChannelDestination] });
  }
  function removeDest(i: number) {
    updateNodeData(nodeId, { destinations: destinations.filter((_, idx) => idx !== i) });
  }
  function pickRegistered(i: number, value: string) {
    const entry = registered.find((e) => e.to === value);
    patchDest(i, { to: value, label: entry?.label ?? value });
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

  <!-- Sending account (linked accounts only — no free text) -->
  <div class="flex flex-col gap-1">
    <label for="ch-account" class="text-[11px] font-medium text-foreground">Sending account</label>
    <select
      id="ch-account"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground disabled:opacity-50"
      value={data.accountId ?? ''}
      disabled={!data.channel}
      onchange={(e) => setAccount((e.target as HTMLSelectElement).value)}
    >
      <option value="">Default account</option>
      {#each accounts as a (a.accountId)}
        <option value={a.accountId}>{a.label}{a.isDefault ? ' (default)' : ''}{a.connected ? '' : ' — offline'}</option>
      {/each}
      {#if data.accountId && !accounts.some((a) => a.accountId === data.accountId)}
        <option value={data.accountId}>{data.accountId}</option>
      {/if}
    </select>
    {#if data.channel && accounts.length === 0}
      <p class="text-[10px] text-amber-400/80 leading-snug">
        No linked account for {data.channel}. Link one in <span class="text-foreground">Settings → Channels</span> — the gateway can't send without it.
      </p>
    {/if}
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
              title="Pick a user who linked this channel to their account"
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
          {#if registered.length === 0}
            <p class="text-[10px] text-amber-400/80 leading-snug">
              No one has linked their {data.channel || 'channel'} account yet. Switch to <span class="text-foreground">Custom</span>, or link an account in Settings.
            </p>
          {:else}
            <select
              class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
              value={d.to}
              onchange={(e) => pickRegistered(i, (e.target as HTMLSelectElement).value)}
            >
              <option value="" disabled>Select a registered user…</option>
              {#each registered as e (e.id)}
                <option value={e.to}>{e.label}{e.verified ? '' : ' (unverified)'}</option>
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
