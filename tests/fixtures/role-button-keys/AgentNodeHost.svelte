<script lang="ts">
  // HC-027 test host: AgentNode is an xyflow node and needs a SvelteFlow around it.
  import { SvelteFlow } from '@xyflow/svelte';
  import AgentNode from '$lib/components/flow-editor/nodes/AgentNode.svelte';
  let nodes = $state.raw([
    { id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: { label: 'Node', agentId: 'a1' } },
  ]);
  let edges = $state.raw([]);
</script>

<div style="width: 600px; height: 400px">
  <SvelteFlow bind:nodes bind:edges nodeTypes={{ agent: AgentNode }} />
</div>
