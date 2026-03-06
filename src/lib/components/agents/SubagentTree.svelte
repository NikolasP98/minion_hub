<script lang="ts">
	import SubagentTreeNode from './SubagentTreeNode.svelte';
	import { getSubagentTree } from '$lib/state/features/subagent-data.svelte';

	const tree = $derived(getSubagentTree());
</script>

<div class="flex flex-col">
	{#each tree as node (node.session.key)}
		<SubagentTreeNode {node} />
	{/each}
</div>
