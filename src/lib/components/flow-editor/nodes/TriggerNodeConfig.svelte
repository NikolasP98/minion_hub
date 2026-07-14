<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
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
  import * as m from '$lib/paraglide/messages';

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
    <label for="tr-event" class="text-[length:var(--font-size-caption)] font-medium text-foreground">Event</label>
    <Select size="sm"
      id="tr-event"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.event}
      onchange={(next) => setEvent(String(next) as TriggerNodeData['event'])}
    >
      {#each EVENTS as e (e.value)}
        <option value={e.value}>{e.label}</option>
      {/each}
    </Select>
    <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">
      {eventHint} {m.flowcfg_eventAppliesToSources()}
    </p>
  </div>

  <!-- Sources -->
  <div class="flex items-center justify-between pt-1">
    <span class="text-[length:var(--font-size-caption)] font-semibold text-foreground">Sources</span>
    <Button variant="ghost"
      class="flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)] hover:text-[var(--color-warning-fg)] transition-colors"
      onclick={addSource}
      title={m.flowcfg_listenOnAnotherChannel()}
    >
      <Plus size={12} /> {m.common_add()}
    </Button>
  </div>

  {#if sources.length === 0}
    <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">
      {m.flowcfg_noSourcesDesc()}
    </p>
  {/if}

  <div class="flex flex-col gap-2">
    {#each sources as s, i (i)}
      {@const accounts = accountsFor(s.channel)}
      <div class="border border-border rounded-lg p-2 flex flex-col gap-1.5 bg-bg3/40">
        <div class="flex items-center gap-1.5">
          <!-- Channel -->
          <Select size="sm"
            class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground capitalize"
            value={s.channel}
            onchange={(next) => patchSource(i, { channel: String(next), accountId: undefined })}
          >
            <option value="" disabled>{m.flowcfg_selectChannel()}</option>
            {#each channels as c (c.id)}
              <option value={c.id}>{c.label}</option>
            {/each}
            {#if s.channel && !channels.some((c) => c.id === s.channel)}
              <option value={s.channel}>{s.channel}</option>
            {/if}
          </Select>
          <Button variant="ghost"
            class="shrink-0 text-muted/60 hover:text-[var(--color-danger-fg)] transition-colors"
            onclick={() => removeSource(i)}
            title={m.flowcfg_removeSource()}
            aria-label={m.flowcfg_removeSource()}
          >
            <Trash2 size={12} />
          </Button>
        </div>

        <!-- Account (linked) -->
        {#if s.channel}
          <Select size="sm"
            class="w-full text-[length:var(--font-size-caption)] bg-bg3 border border-border rounded px-2 py-1 text-foreground"
            value={s.accountId ?? ''}
            onchange={(next) => patchSource(i, { accountId: String(next) || undefined })}
          >
            <option value="">{m.flowcfg_anyLinkedAccount()}</option>
            {#each accounts as a (a.accountId)}
              <option value={a.accountId}>{a.label}{a.phone && a.phone !== a.label ? ` · ${a.phone}` : ''}{a.connected ? '' : ' — offline'}</option>
            {/each}
          </Select>
          {#if accounts.length === 0}
            <p class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80 leading-snug">
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
    <span class="text-xs font-medium text-foreground">{m.flowcfg_replyToChannel()}</span>
  </label>
  <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug -mt-1.5">
    {m.flowcfg_sendOutputBack()}
  </p>

  <!-- Optional agent filter -->
  <div class="flex flex-col gap-1 pt-1">
    <label for="tr-agent" class="text-[length:var(--font-size-caption)] font-medium text-foreground">
      Agent filter <span class="text-muted font-normal">(optional)</span>
    </label>
    <input
      id="tr-agent"
      type="text"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
      placeholder={m.flowcfg_agentIdPlaceholder()}
      value={data.filterAgentId ?? ''}
      oninput={(e) => setAgentFilter((e.target as HTMLInputElement).value)}
    />
  </div>
</div>
