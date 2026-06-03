<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { HandoffNodeData, DestinationListValue } from '$lib/state/features/flow-editor.svelte';
  import DestinationListField from './DestinationListField.svelte';

  let { nodeId }: { nodeId: string } = $props();
  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as HandoffNodeData);

  const destValue = $derived<DestinationListValue>({
    channel: data.destinations?.[0]?.channel,
    accountId: data.destinations?.[0]?.accountId,
    destinations: (data.destinations ?? []).map((d) => ({ kind: 'custom', to: d.to, label: d.to })),
  });
  function onDest(v: DestinationListValue) {
    updateNodeData(nodeId, {
      destinations: v.destinations
        .filter((d) => d.to.trim())
        .map((d) => ({ channel: v.channel ?? 'whatsapp', to: d.to, accountId: v.accountId })),
    });
  }
  function set(key: keyof HandoffNodeData, value: unknown) {
    updateNodeData(nodeId, { [key]: value });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div>
    <span class="text-[11px] font-medium text-foreground">Owners (claim candidates)</span>
    <DestinationListField value={destValue} onChange={onDest} />
  </div>
  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Priority label</span>
    <input class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder="MEDIA / ALTA" value={data.priority ?? ''}
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
