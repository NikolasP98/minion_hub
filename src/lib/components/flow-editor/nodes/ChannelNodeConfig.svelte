<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ChannelNodeData, DestinationListValue } from '$lib/state/features/flow-editor.svelte';
  import DestinationListField from './DestinationListField.svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as ChannelNodeData);

  // The built-in Channel node stores channel/accountId/destinations directly on
  // `data` — map it through the shared destination-list field.
  const value = $derived<DestinationListValue>({
    channel: data.channel,
    accountId: data.accountId,
    destinations: Array.isArray(data.destinations) ? data.destinations : [],
  });

  function onChange(v: DestinationListValue) {
    updateNodeData(nodeId, { channel: v.channel ?? '', accountId: v.accountId, destinations: v.destinations });
  }
</script>

<div class="px-3 py-3">
  <DestinationListField {value} {onChange} />
</div>
