<script lang="ts">
	import {
		dreamState,
		loadDreamHistory,
		clearDreamState,
		formatTimeSince
	} from '$lib/state/features/dream-data.svelte';

	let { agentId }: { agentId: string } = $props();

	$effect(() => {
		if (agentId) {
			loadDreamHistory(agentId);
		}
		return () => {
			clearDreamState();
		};
	});
</script>

<div class="flex flex-col gap-4 p-4 text-[13px]">
	{#if dreamState.loading}
		<p class="text-muted">Loading dream activity...</p>
	{:else if dreamState.error}
		<p class="text-red-400">{dreamState.error}</p>
	{:else if dreamState.data}
		<!-- Status cards -->
		<div class="grid grid-cols-3 gap-3">
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1">Last Consolidation</div>
				<div class="font-medium">{formatTimeSince(dreamState.data.state.lastConsolidatedAt)}</div>
			</div>
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1">Last Scan</div>
				<div class="font-medium">{formatTimeSince(dreamState.data.state.lastSessionScanAt)}</div>
			</div>
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1">Pending Notes</div>
				<div class="font-medium">{dreamState.data.pendingNotes}</div>
			</div>
		</div>

		<!-- History timeline -->
		<div>
			<h3 class="text-muted text-[11px] uppercase tracking-wider mb-2">Consolidation History</h3>
			{#if dreamState.data.history.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 text-muted py-6">
					<span class="text-[24px] opacity-30">&#x1f4a4;</span>
					<span>No dream activity yet</span>
					<p class="text-[11px] text-center max-w-xs opacity-60 leading-relaxed">
						Dreams run automatically after sessions end. They consolidate daily notes
						into long-term memory when enough activity has accumulated.
					</p>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each dreamState.data.history as entry}
						<div class="bg-white/[0.03] border border-border rounded-lg p-3">
							<div class="text-muted text-[11px] mb-1">{entry.timestamp}</div>
							<div class="text-[12px] leading-relaxed whitespace-pre-wrap">{entry.content}</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center gap-2 text-muted py-6">
			<span class="text-[24px] opacity-30">&#x1f4a4;</span>
			<span>No dream data available</span>
		</div>
	{/if}
</div>
