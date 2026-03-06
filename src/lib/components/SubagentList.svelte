<script lang="ts">
	import SubagentCard from './SubagentCard.svelte';
	import SubagentEmptyState from './SubagentEmptyState.svelte';
	import ViewSwitcher from './ViewSwitcher.svelte';
	import {
		subagentState,
		getSortedSubagents,
		selectSubagent
	} from '$lib/state/subagent-data.svelte';

	const sorted = $derived(getSortedSubagents());
</script>

<div class="flex flex-col h-full overflow-hidden bg-bg">
	<!-- Header -->
	<div class="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
		<span class="text-[11px] font-semibold text-muted uppercase tracking-wider">
			Subagents
		</span>
		<span class="text-[10px] text-muted/50 font-mono">
			{subagentState.sessions.length}
		</span>
	</div>

	<!-- Scrollable list -->
	<div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-color-border">
		{#if subagentState.loading}
			<div class="flex items-center justify-center py-8 text-muted text-[11px]">
				Loading...
			</div>
		{:else if subagentState.error}
			<div class="flex items-center justify-center py-8 text-red-400 text-[11px]">
				{subagentState.error}
			</div>
		{:else if sorted.length === 0}
			<SubagentEmptyState />
		{:else}
			{#each sorted as session (session.key)}
				<SubagentCard
					{session}
					selected={subagentState.selectedKey === session.key}
					onclick={() => selectSubagent(session.key)}
				/>
			{/each}
		{/if}
	</div>

	<!-- View switcher -->
	<ViewSwitcher active="list" />
</div>
