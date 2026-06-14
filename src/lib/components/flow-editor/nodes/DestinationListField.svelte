<script lang="ts">
  import type { DestinationListValue, ChannelDestination } from '$lib/state/features/flow-editor.svelte';
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
  import * as m from '$lib/paraglide/messages';

  // Controlled field: parent owns the value (node data for the built-in Channel
  // node, or a `config[key]` slot for a `destination-list` plugin field).
  let { value, onChange }: { value: DestinationListValue; onChange: (v: DestinationListValue) => void } = $props();

  const channel = $derived(value.channel ?? '');
  const destinations = $derived(Array.isArray(value.destinations) ? value.destinations : []);

  const channels = $derived(channelPlugins());
  const accounts = $derived(accountsFor(channel));
  const registered = $derived(identitiesFor(channel));

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
  const hint = $derived(HINTS[channel] ?? { placeholder: 'destination id', hint: 'Channel-specific address' });

  // ── Mutations ───────────────────────────────────────────────────────────────
  function setChannel(next: string) {
    // Reset account + registered destinations: they're channel-specific.
    onChange({
      ...value,
      channel: next,
      accountId: undefined,
      destinations: destinations.map((d) => (d.kind === 'user' ? { ...d, to: '', label: undefined } : d)),
    });
  }
  function setAccount(accountId: string) {
    onChange({ ...value, accountId: accountId || undefined });
  }
  function patchDest(i: number, patch: Partial<ChannelDestination>) {
    onChange({ ...value, destinations: destinations.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  }
  function addDest() {
    onChange({ ...value, destinations: [...destinations, { kind: 'custom', to: '' } as ChannelDestination] });
  }
  function removeDest(i: number) {
    onChange({ ...value, destinations: destinations.filter((_, idx) => idx !== i) });
  }
  function pickRegistered(i: number, picked: string) {
    const entry = registered.find((e) => e.to === picked);
    patchDest(i, { to: picked, label: entry?.label ?? picked });
  }
</script>

<div class="flex flex-col gap-3">
  <!-- Channel selector -->
  <div class="flex flex-col gap-1">
    <label for="ch-channel" class="text-[11px] font-medium text-foreground">Channel</label>
    <select
      id="ch-channel"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground capitalize"
      value={channel}
      onchange={(e) => setChannel((e.target as HTMLSelectElement).value)}
    >
      <option value="" disabled>{m.flowcfg_selectChannel()}</option>
      {#each channels as c (c.id)}
        <option value={c.id}>{c.label}</option>
      {/each}
      {#if channel && !channels.some((c) => c.id === channel)}
        <option value={channel}>{channel}</option>
      {/if}
    </select>
  </div>

  <!-- Sending account (linked accounts only — no free text) -->
  <div class="flex flex-col gap-1">
    <label for="ch-account" class="text-[11px] font-medium text-foreground">Sending account</label>
    <select
      id="ch-account"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground disabled:opacity-50"
      value={value.accountId ?? ''}
      disabled={!channel}
      onchange={(e) => setAccount((e.target as HTMLSelectElement).value)}
    >
      <option value="">{m.flowcfg_anyLinkedAccount()}</option>
      {#each accounts as a (a.accountId)}
        <option value={a.accountId}>{a.label}{a.phone && a.phone !== a.label ? ` · ${a.phone}` : ''}{a.connected ? '' : ' — offline'}</option>
      {/each}
      {#if value.accountId && !accounts.some((a) => a.accountId === value.accountId)}
        <option value={value.accountId}>{value.accountId}</option>
      {/if}
    </select>
    {#if channel && accounts.length === 0}
      <p class="text-[10px] text-amber-400/80 leading-snug">
        No linked account for {channel}. Link one in <span class="text-foreground">Settings → Channels</span> — the gateway can't send without it.
      </p>
    {/if}
  </div>

  <!-- Destinations -->
  <div class="flex items-center justify-between pt-1">
    <span class="text-[11px] font-semibold text-foreground">Destinations</span>
    <button
      class="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
      onclick={addDest}
      disabled={!channel}
      title={channel ? m.flowcfg_addDestination() : m.flowcfg_pickChannelFirst()}
    >
      <Plus size={12} /> {m.common_add()}
    </button>
  </div>

  {#if !channel}
    <p class="text-[10px] text-muted">{m.flowcfg_chooseChannelToAdd()}</p>
  {:else if destinations.length === 0}
    <p class="text-[10px] text-muted">{m.flowcfg_noDestinationsYet()}</p>
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
              title={m.flowcfg_pickLinkedUser()}
            >
              <User size={10} /> {m.flowcfg_registered()}
            </button>
            <button
              class="flex items-center gap-1 px-2 py-0.5 text-[10px] {d.kind === 'custom' ? 'bg-cyan-500/25 text-cyan-200' : 'text-muted hover:text-foreground'}"
              onclick={() => patchDest(i, { kind: 'custom' })}
              title={m.flowcfg_enterAddressManually()}
            >
              <Pencil size={10} /> {m.flowcfg_custom()}
            </button>
          </div>
          <button
            class="text-muted/60 hover:text-red-400 transition-colors"
            onclick={() => removeDest(i)}
            title={m.flowcfg_removeDestination()}
            aria-label={m.flowcfg_removeDestination()}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {#if d.kind === 'user'}
          {#if registered.length === 0}
            <p class="text-[10px] text-amber-400/80 leading-snug">
              No one has linked their {channel || 'channel'} account yet. Switch to <span class="text-foreground">Custom</span>, or link an account in Settings.
            </p>
          {:else}
            <select
              class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
              value={d.to}
              onchange={(e) => pickRegistered(i, (e.target as HTMLSelectElement).value)}
            >
              <option value="" disabled>{m.flowcfg_selectRegisteredUser()}</option>
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
            placeholder={m.flowcfg_labelOptional()}
            value={d.label ?? ''}
            oninput={(e) => patchDest(i, { label: (e.target as HTMLInputElement).value || undefined })}
          />
          <p class="text-[10px] text-muted leading-snug">{hint.hint}</p>
        {/if}
      </div>
    {/each}
  </div>
</div>
