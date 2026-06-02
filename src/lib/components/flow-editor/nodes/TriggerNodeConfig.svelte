<script lang="ts">
  import { flowEditorState, updateNodeData, triggerSources } from '$lib/state/features/flow-editor.svelte';
  import type { TriggerNodeData, ChannelTriggerSource } from '$lib/state/features/flow-editor.svelte';
  import { conn } from '$lib/state/gateway';
  import {
    channelPlugins,
    ensureChannelPlugins,
    ensureChannelStatus,
    accountsFor,
  } from '$lib/state/features/channel-sources.svelte';
  import { Plus, Trash2 } from 'lucide-svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as TriggerNodeData);
  const sources = $derived(triggerSources(data));

  const EVENTS: { value: TriggerNodeData['event']; label: string; hint: string }[] = [
    { value: 'message:received', label: 'Message received', hint: 'Fires on an inbound message.' },
    { value: 'message:sent', label: 'Message sent', hint: 'Fires when a message is sent out.' },
  ];
  const eventHint = $derived(EVENTS.find((e) => e.value === data.event)?.hint ?? '');

  const channels = $derived(channelPlugins());

  $effect(() => {
    if (!conn.connected) return;
    void ensureChannelPlugins();
    void ensureChannelStatus();
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  function commit(next: ChannelTriggerSource[]) {
    // Write the canonical `sources`; drop the legacy shapes so they don't shadow it.
    updateNodeData(nodeId, { sources: next, channels: undefined, filterChannelId: undefined });
  }
  function setEvent(event: TriggerNodeData['event']) {
    const label = EVENTS.find((e) => e.value === event)?.label ?? event;
    updateNodeData(nodeId, { event, label });
  }
  function addSource() {
    commit([...sources, { channel: '' }]);
  }
  function patchSource(i: number, patch: Partial<ChannelTriggerSource>) {
    commit(sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSource(i: number) {
    commit(sources.filter((_, idx) => idx !== i));
  }
  function setAgentFilter(value: string) {
    updateNodeData(nodeId, { filterAgentId: value.trim() || undefined });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <!-- Event -->
  <div class="flex flex-col gap-1">
    <label for="tr-event" class="text-[11px] font-medium text-foreground">Event</label>
    <select
      id="tr-event"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.event}
      onchange={(e) => setEvent((e.target as HTMLSelectElement).value as TriggerNodeData['event'])}
    >
      {#each EVENTS as e (e.value)}
        <option value={e.value}>{e.label}</option>
      {/each}
    </select>
    <p class="text-[10px] text-muted leading-snug">
      {eventHint} The event applies to every source below — add another trigger node for a different event.
    </p>
  </div>

  <!-- Sources -->
  <div class="flex items-center justify-between pt-1">
    <span class="text-[11px] font-semibold text-foreground">Sources</span>
    <button
      class="flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200 transition-colors"
      onclick={addSource}
      title="Listen on another channel"
    >
      <Plus size={12} /> Add
    </button>
  </div>

  {#if sources.length === 0}
    <p class="text-[10px] text-muted leading-snug">
      No sources — this trigger fires on <span class="text-foreground">every</span> channel. Add one to
      scope it to a specific channel / account.
    </p>
  {/if}

  <div class="flex flex-col gap-2">
    {#each sources as s, i (i)}
      {@const accounts = accountsFor(s.channel)}
      <div class="border border-border rounded-lg p-2 flex flex-col gap-1.5 bg-bg3/40">
        <div class="flex items-center gap-1.5">
          <!-- Channel -->
          <select
            class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground capitalize"
            value={s.channel}
            onchange={(e) => patchSource(i, { channel: (e.target as HTMLSelectElement).value, accountId: undefined })}
          >
            <option value="" disabled>Select channel…</option>
            {#each channels as c (c.id)}
              <option value={c.id}>{c.label}</option>
            {/each}
            {#if s.channel && !channels.some((c) => c.id === s.channel)}
              <option value={s.channel}>{s.channel}</option>
            {/if}
          </select>
          <button
            class="shrink-0 text-muted/60 hover:text-red-400 transition-colors"
            onclick={() => removeSource(i)}
            title="Remove source"
            aria-label="Remove source"
          >
            <Trash2 size={12} />
          </button>
        </div>

        <!-- Account (linked) -->
        {#if s.channel}
          <select
            class="w-full text-[11px] bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            value={s.accountId ?? ''}
            onchange={(e) => patchSource(i, { accountId: (e.target as HTMLSelectElement).value || undefined })}
          >
            <option value="">Any linked account</option>
            {#each accounts as a (a.accountId)}
              <option value={a.accountId}>{a.label}{a.isDefault ? ' (default)' : ''}{a.connected ? '' : ' — offline'}</option>
            {/each}
          </select>
          {#if accounts.length === 0}
            <p class="text-[10px] text-amber-400/80 leading-snug">
              No linked account found for {s.channel} — link one in Settings, or leave as “any”.
            </p>
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  <!-- Reply to channel -->
  <label class="flex items-center gap-2 cursor-pointer pt-1">
    <input
      type="checkbox"
      class="w-3.5 h-3.5 accent-amber-400"
      checked={data.deliverResponse}
      onchange={(e) => updateNodeData(nodeId, { deliverResponse: (e.target as HTMLInputElement).checked })}
    />
    <span class="text-xs font-medium text-foreground">Reply to channel</span>
  </label>
  <p class="text-[10px] text-muted leading-snug -mt-1.5">
    Send the flow's final output back to the originating chat.
  </p>

  <!-- Optional agent filter -->
  <div class="flex flex-col gap-1 pt-1">
    <label for="tr-agent" class="text-[11px] font-medium text-foreground">
      Agent filter <span class="text-muted font-normal">(optional)</span>
    </label>
    <input
      id="tr-agent"
      type="text"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
      placeholder="agent id (blank = any agent)"
      value={data.filterAgentId ?? ''}
      oninput={(e) => setAgentFilter((e.target as HTMLInputElement).value)}
    />
  </div>
</div>
