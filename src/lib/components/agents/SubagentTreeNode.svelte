<script lang="ts">
	import SubagentTreeNode from './SubagentTreeNode.svelte';
	import {
		type SubagentTreeNode as TreeNode,
		resolveStatus,
		formatDuration,
		selectSubagent,
		subagentState
	} from '$lib/state/features/subagent-data.svelte';
	import { piAgentState, killSubagent, steerSubagent } from '$lib/state/features/pi-agent-state.svelte';

	let {
		node,
		depth = 0
	}: {
		node: TreeNode;
		depth?: number;
	} = $props();

	let collapsed = $state(false);
	let steerOpen = $state(false);
	let steerMessage = $state('');

	// Enrich with piAgentState data for accurate status and token counts
	const piEntry = $derived(piAgentState.subagents.find((s) => s.key === node.session.key));
	// Use pi-agent registry status (endedAt-based) when available, fall back to session heuristic
	const status = $derived(piEntry?.status ?? resolveStatus(node.session));
	const selected = $derived(subagentState.selectedKey === node.session.key);
	const hasChildren = $derived(node.children.length > 0);
	const isCompleted = $derived(status === 'completed' || status === 'failed');
	const totalTokens = $derived((piEntry?.inputTokens ?? 0) + (piEntry?.outputTokens ?? 0));

	// Template badge: derive from label by splitting on ":"
	const templateBadge = $derived.by(() => {
		const label = node.session.label ?? '';
		if (label.includes(':')) return label.split(':')[0].trim();
		return null;
	});

	function formatCompactTokens(n: number): string {
		if (n === 0) return '';
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
		return String(n);
	}

	const statusColor: Record<string, string> = {
		running: 'bg-yellow-400',
		completed: 'bg-emerald-400',
		failed: 'bg-red-400',
		unknown: 'bg-zinc-500'
	};

	function handleKill(e: MouseEvent) {
		e.stopPropagation();
		killSubagent(node.session.key);
	}

	function handleSteerToggle(e: MouseEvent) {
		e.stopPropagation();
		steerOpen = !steerOpen;
	}

	function handleSteer() {
		if (!steerMessage.trim()) return;
		steerSubagent(node.session.key, steerMessage.trim());
		steerMessage = '';
		steerOpen = false;
	}
</script>

<div class="flex flex-col">
	<!-- Node row -->
	<div
		class="group flex items-center gap-1.5 w-full py-1.5 pr-3 transition-colors duration-100
			hover:bg-white/[0.03] cursor-pointer text-foreground
			{selected ? '!bg-bg3' : ''}
			{isCompleted ? 'opacity-60' : ''}"
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

		<!-- Status dot (pulse for running) -->
		<span class="w-2 h-2 rounded-full shrink-0 {statusColor[status] ?? statusColor.unknown} {status === 'running' ? 'animate-pulse' : ''}"></span>

		<!-- Label -->
		<span class="text-[11px] font-medium truncate flex-1">
			{node.session.label || node.session.displayName || node.session.key.split(':').pop() || 'Unnamed'}
		</span>

		<!-- Template badge -->
		{#if templateBadge}
			<span class="text-[8px] px-1 py-0.5 rounded bg-accent/20 text-accent/70 shrink-0">{templateBadge}</span>
		{/if}

		<!-- Token count -->
		{#if totalTokens > 0}
			<span class="text-[9px] text-muted/50 font-mono shrink-0">{formatCompactTokens(totalTokens)}t</span>
		{/if}

		<!-- Model -->
		<span class="text-[9px] text-muted/50 truncate max-w-20">
			{node.session.model ?? ''}
		</span>

		<!-- Duration -->
		<span class="text-[9px] text-muted/40 font-mono shrink-0">
			{formatDuration(node.session)}
		</span>

		<!-- Kill/steer actions (on hover, running only) -->
		{#if status === 'running'}
			<div class="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
				<button
					type="button"
					class="text-[9px] text-red-400 hover:text-red-300 px-1 bg-transparent border-0 cursor-pointer"
					onclick={handleKill}
				>Kill</button>
				<button
					type="button"
					class="text-[9px] text-blue-400 hover:text-blue-300 px-1 bg-transparent border-0 cursor-pointer"
					onclick={handleSteerToggle}
				>Steer</button>
			</div>
		{/if}
	</div>

	<!-- Steer inline input -->
	{#if steerOpen}
		<div class="flex items-center gap-1 px-2 py-1" style="padding-left: {(depth + 1) * 16 + 8}px">
			<input
				type="text"
				bind:value={steerMessage}
				placeholder="Type steering message..."
				class="flex-1 bg-bg3 border border-border rounded text-[11px] px-2 py-1 text-foreground"
				onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && steerMessage.trim()) { handleSteer(); } }}
			/>
			<button
				type="button"
				class="text-[9px] px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 cursor-pointer border-0"
				onclick={handleSteer}
			>Send</button>
		</div>
	{/if}

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
