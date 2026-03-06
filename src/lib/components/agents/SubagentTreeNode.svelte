<script lang="ts">
	import SubagentTreeNode from './SubagentTreeNode.svelte';
	import {
		type SubagentTreeNode as TreeNode,
		resolveStatus,
		formatDuration,
		selectSubagent,
		subagentState
	} from '$lib/state/features/subagent-data.svelte';

	let {
		node,
		depth = 0
	}: {
		node: TreeNode;
		depth?: number;
	} = $props();

	let collapsed = $state(false);

	const status = $derived(resolveStatus(node.session));
	const selected = $derived(subagentState.selectedKey === node.session.key);
	const hasChildren = $derived(node.children.length > 0);

	const statusColor: Record<string, string> = {
		running: 'bg-yellow-400',
		completed: 'bg-emerald-400',
		failed: 'bg-red-400',
		unknown: 'bg-zinc-500'
	};
</script>

<div class="flex flex-col">
	<!-- Node row -->
	<div
		class="flex items-center gap-1.5 w-full py-1.5 pr-3 transition-colors duration-100
			hover:bg-white/[0.03] cursor-pointer text-foreground
			{selected ? '!bg-bg3' : ''}"
		style="padding-left: {depth * 16 + 8}px"
		role="button"
		tabindex="0"
		onclick={() => selectSubagent(node.session.key)}
		onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') selectSubagent(node.session.key); }}
	>
		<!-- Expand/collapse toggle -->
		{#if hasChildren}
			<button
				type="button"
				class="w-4 h-4 flex items-center justify-center text-muted/50 hover:text-muted
					bg-transparent border-0 cursor-pointer p-0 shrink-0 text-[10px]"
				onclick={(e: MouseEvent) => { e.stopPropagation(); collapsed = !collapsed; }}
			>
				{collapsed ? '\u25B6' : '\u25BC'}
			</button>
		{:else}
			<span class="w-4 shrink-0"></span>
		{/if}

		<!-- Status dot -->
		<span class="w-2 h-2 rounded-full shrink-0 {statusColor[status] ?? statusColor.unknown}"></span>

		<!-- Label -->
		<span class="text-[11px] font-medium truncate flex-1">
			{node.session.label || node.session.displayName || node.session.key.split(':').pop() || 'Unnamed'}
		</span>

		<!-- Model -->
		<span class="text-[9px] text-muted/50 truncate max-w-20">
			{node.session.model ?? ''}
		</span>

		<!-- Duration -->
		<span class="text-[9px] text-muted/40 font-mono shrink-0">
			{formatDuration(node.session)}
		</span>
	</div>

	<!-- Children -->
	{#if hasChildren && !collapsed}
		<div class="relative" style="margin-left: {depth * 16 + 16}px">
			<div class="absolute left-0 top-0 bottom-0 w-px bg-white/[0.06]"></div>
			{#each node.children as child (child.session.key)}
				<SubagentTreeNode node={child} depth={depth + 1} />
			{/each}
		</div>
	{/if}
</div>
