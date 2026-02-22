<script lang="ts">
  import { conn } from '$lib/state/connection.svelte';
  import * as m from '$lib/paraglide/messages';
  import { configState, setField, isDirty, save, discard } from '$lib/state/config.svelte';
  import { SvelteMap } from 'svelte/reactivity';

  type BindingPeer = { kind: 'dm' | 'group'; id: string };
  type BindingMatch = { channel: string; peer: BindingPeer };
  type BindingEntry = { agentId: string; match: BindingMatch };

  const CHANNELS = ['whatsapp', 'telegram', 'discord'] as const;
  type Channel = (typeof CHANNELS)[number];

  const CHANNEL_ICONS: Record<Channel, string> = {
    whatsapp: '📱',
    telegram: '✈️',
    discord: '🎮',
  };

  // Derived bindings from config state
  const bindings = $derived(
    ((configState.current?.bindings ?? []) as BindingEntry[])
  );

  // Group by agentId, preserving global index to avoid proxy identity issues
  const grouped = $derived.by(() => {
    const map = new SvelteMap<string, { entry: BindingEntry; globalIdx: number }[]>();
    for (let i = 0; i < bindings.length; i++) {
      const b = bindings[i];
      const list = map.get(b.agentId) ?? [];
      list.push({ entry: b, globalIdx: i });
      map.set(b.agentId, list);
    }
    return map;
  });

  // Add form state
  let addAgentId = $state('');
  let addChannel = $state<Channel>('whatsapp');
  let addKind = $state<'dm' | 'group'>('dm');
  let addPeerId = $state('');
  let addError = $state<string | null>(null);

  function removeBinding(index: number) {
    const next = [...bindings];
    next.splice(index, 1);
    setField('bindings', next);
  }

  function addBinding() {
    addError = null;
    if (!addAgentId.trim()) { addError = 'Agent ID is required'; return; }
    if (!addPeerId.trim()) { addError = 'Peer ID is required'; return; }
    const next: BindingEntry[] = [
      ...bindings,
      {
        agentId: addAgentId.trim(),
        match: { channel: addChannel, peer: { kind: addKind, id: addPeerId.trim() } },
      },
    ];
    setField('bindings', next);
    addAgentId = '';
    addPeerId = '';
  }

  const saving = $derived(configState.saving);
  const saveError = $derived(configState.saveError);
</script>

{#if !conn.connected}
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center">
      <p class="text-muted-foreground text-sm mb-3">{m.config_noServer()}</p>
      <a href="/" class="text-xs text-accent no-underline hover:underline">{m.config_goToDashboard()}</a>
    </div>
  </div>
{:else if configState.loading && !configState.loaded}
  <div class="flex-1 flex items-center justify-center">
    <div class="text-xs text-muted-foreground">{m.common_loading()}</div>
  </div>
{:else}
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-3xl mx-auto space-y-6">

      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">{m.bindings_title()}</h2>
      <p class="text-xs text-muted-foreground -mt-4">{m.bindings_subtitle()}</p>

      <!-- Grouped binding cards -->
      {#if grouped.size === 0}
        <div class="text-muted text-xs py-8 text-center">{m.bindings_noBindings()}</div>
      {:else}
        {#each [...grouped.entries()] as [agentId, entries] (agentId)}
          <div class="bg-card border border-border rounded-lg overflow-hidden">
            <div class="px-4 py-2.5 bg-bg2 border-b border-border">
              <span class="text-xs font-bold text-foreground uppercase tracking-wide">{agentId}</span>
            </div>
            <div class="divide-y divide-border/50">
              {#each entries as { entry: b, globalIdx } (globalIdx)}
                <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-bg2/50 transition-colors group">
                  <span class="text-base leading-none" title={b.match.channel}>
                    {CHANNEL_ICONS[b.match.channel as Channel] ?? '🔗'}
                  </span>
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full
                    {b.match.peer.kind === 'dm' ? 'bg-accent/15 text-accent' : 'bg-muted-foreground/20 text-muted-foreground'}">
                    {b.match.peer.kind.toUpperCase()}
                  </span>
                  <span class="font-mono text-xs text-foreground flex-1 min-w-0 truncate">{b.match.peer.id}</span>
                  <span class="text-[10px] text-muted capitalize">{b.match.channel}</span>
                  <button
                    class="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-destructive bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                    onclick={() => removeBinding(globalIdx)}
                    title="Remove binding"
                  >
                    ✕
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

      <!-- Add binding form -->
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <p class="text-xs font-semibold text-foreground">{m.bindings_add()}</p>
        <div class="grid grid-cols-2 gap-3">
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder="Agent ID *"
            bind:value={addAgentId}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder="Peer ID (phone / group ID) *"
            bind:value={addPeerId}
          />
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-[7px] text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={addChannel}
          >
            {#each CHANNELS as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-[7px] text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={addKind}
          >
            <option value="dm">DM</option>
            <option value="group">Group</option>
          </select>
        </div>
        {#if addError}
          <p class="text-xs text-destructive">{addError}</p>
        {/if}
        <button
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
          onclick={addBinding}
        >
          {m.common_add()}
        </button>
      </div>

    </div>
  </div>

  <!-- Save bar (same pattern as Config page) -->
  {#if isDirty.value || saving || saveError}
    <div class="shrink-0 border-t border-border bg-bg/95 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
      <span class="text-xs text-muted-foreground flex-1">
        {#if saveError}
          <span class="text-destructive">{saveError}</span>
        {:else if saving}
          {m.common_loading()}
        {:else}
          {m.saveBar_unsaved()}
        {/if}
      </span>
      <button
        class="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground bg-transparent cursor-pointer font-[inherit] hover:bg-bg3 transition-colors"
        onclick={discard}
        disabled={saving}
      >
        {m.saveBar_discard()}
      </button>
      <button
        class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        onclick={save}
        disabled={saving}
      >
        {saving ? m.common_loading() : m.saveBar_save()}
      </button>
    </div>
  {/if}
{/if}
