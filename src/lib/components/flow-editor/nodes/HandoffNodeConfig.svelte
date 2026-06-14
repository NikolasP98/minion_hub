<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type {
    HandoffNodeData,
    HandoffDestination,
    DestinationListValue,
    ChannelDestination,
  } from '$lib/state/features/flow-editor.svelte';
  import DestinationListField from './DestinationListField.svelte';
  import * as m from '$lib/paraglide/messages';

  let { nodeId }: { nodeId: string } = $props();
  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as HandoffNodeData);

  // DestinationListField is a controlled editor that needs to hold in-progress
  // rows (a freshly-added row has an empty `to`; toggling to "Registered" clears
  // `to` until a user is picked). If we derived the field value straight from
  // persisted node data and filtered empties on every change, those transient
  // rows would vanish the instant they appear — making "Add" and "Registered"
  // look broken. So keep a local working copy the field can mutate freely, and
  // project only the valid (non-empty) rows back into node data. `{#key nodeId}`
  // in NodeConfigPanel remounts this component per node, re-seeding cleanly.
  let working = $state<DestinationListValue>(seed());
  function seed(): DestinationListValue {
    const list = Array.isArray(data.destinations) ? data.destinations : [];
    return {
      channel: list[0]?.channel ?? 'whatsapp',
      accountId: list[0]?.accountId,
      destinations: list.map(
        (d) => ({ kind: 'custom', to: d.to, label: d.to } as ChannelDestination),
      ),
    };
  }

  function onDest(v: DestinationListValue) {
    working = v;
    const destinations: HandoffDestination[] = v.destinations
      .filter((d) => d.to.trim())
      .map((d) => ({ channel: v.channel ?? 'whatsapp', to: d.to.trim(), accountId: v.accountId }));
    updateNodeData(nodeId, { destinations });
  }
  function set(key: keyof HandoffNodeData, value: unknown) {
    updateNodeData(nodeId, { [key]: value });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div>
    <span class="text-[11px] font-medium text-foreground">Owners (claim candidates)</span>
    <DestinationListField value={working} onChange={onDest} />
  </div>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Priority label</span>
    <input class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_priorityLabelPlaceholder()} value={data.priority ?? ''}
      oninput={(e) => set('priority', (e.target as HTMLInputElement).value || undefined)} />
  </label>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Suggested replies</span>
    <input type="number" min="0" max="5" class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.suggestionCount ?? 3}
      oninput={(e) => set('suggestionCount', Number((e.target as HTMLInputElement).value))} />
  </label>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Language</span>
    <select class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.language ?? 'es'} onchange={(e) => set('language', (e.target as HTMLSelectElement).value)}>
      <option value="es">Español</option><option value="en">English</option>
    </select>
  </label>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Closing message (on /end)</span>
    <textarea class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-12"
      value={data.closingMessage ?? ''}
      oninput={(e) => set('closingMessage', (e.target as HTMLTextAreaElement).value || undefined)}></textarea>
  </label>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Context for suggestions (system prompt)</span>
    <textarea class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground resize-y min-h-12"
      value={data.systemPrompt ?? ''}
      oninput={(e) => set('systemPrompt', (e.target as HTMLTextAreaElement).value || undefined)}></textarea>
  </label>
</div>
