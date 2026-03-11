<script lang="ts">
	import SubagentTreeNode from './SubagentTreeNode.svelte';
	import { getSubagentTree, type SubagentTreeNode as TreeNodeType } from '$lib/state/features/subagent-data.svelte';
	import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';

	// Group tree nodes by orchestration ID
	const groupedTree = $derived.by(() => {
		const tree = getSubagentTree();
		const subagentMap = new Map(piAgentState.subagents.map((s) => [s.key, s]));
		const orchGroups = new Map<string, TreeNodeType[]>();
		const ungrouped: TreeNodeType[] = [];

		for (const node of tree) {
			const entry = subagentMap.get(node.session.key);
			if (entry?.orchestrationId) {
				const group = orchGroups.get(entry.orchestrationId) ?? [];
				group.push(node);
				orchGroups.set(entry.orchestrationId, group);
			} else {
				ungrouped.push(node);
			}
		}

		return { orchGroups, ungrouped };
	});

	// Get orchestration metadata from piAgentState
	function getOrchMeta(orchId: string) {
		return piAgentState.orchestrations.find((o) => o.orchestrationId === orchId);
	}

	const orchStatusColor: Record<string, string> = {
		running: 'bg-yellow-400',
		completed: 'bg-emerald-400',
		failed: 'bg-red-400',
		interrupted: 'bg-red-400'
	};
</script>

<div class="flex flex-col">
	<!-- Orchestration-grouped nodes -->
	{#each [...groupedTree.orchGroups.entries()] as [orchId, nodes] (orchId)}
		{@const meta = getOrchMeta(orchId)}
		<!-- Orchestration header -->
		<div class="flex items-center gap-1.5 px-2 py-1.5 bg-bg2/50 border-b border-border/30">
			<span class="w-1.5 h-1.5 rounded-full shrink-0 {orchStatusColor[meta?.status ?? ''] ?? 'bg-zinc-500'}"></span>
			<span class="text-[10px] font-mono text-muted/70 truncate">{orchId.slice(0, 8)}</span>
			{#if meta?.mode}
				<span class="text-[8px] px-1 py-0.5 rounded bg-accent/10 text-accent/60">{meta.mode}</span>
			{/if}
			<span class="text-[9px] text-muted/50 ml-auto shrink-0">{nodes.length} tasks</span>
		</div>
		<!-- Grouped subagent nodes (rendered at depth 0 since they are under a header) -->
		{#each nodes as node (node.session.key)}
			<SubagentTreeNode {node} />
		{/each}
	{/each}

	<!-- Ungrouped nodes -->
	{#each groupedTree.ungrouped as node (node.session.key)}
		<SubagentTreeNode {node} />
	{/each}
</div>
