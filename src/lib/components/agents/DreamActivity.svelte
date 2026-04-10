<script lang="ts">
	import {
		dreamState,
		loadDreamHistory,
		clearDreamState,
		formatTimeSince
	} from '$lib/state/features/dream-data.svelte';
	import ConfigTooltip from '$lib/components/config/ConfigTooltip.svelte';
	import * as m from '$lib/paraglide/messages';

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
		<p class="text-muted">{m.dream_loading()}</p>
	{:else if dreamState.error}
		<p class="text-red-400">{dreamState.error}</p>
	{:else if dreamState.data}
		<!-- Status cards -->
		<div class="grid grid-cols-3 gap-3">
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1 inline-flex items-center gap-1">
					{m.dream_lastConsolidation()}
					<ConfigTooltip content="Timestamp of the last successful dream cycle. Dreams consolidate daily notes into long-term memory using an LLM. Must be at least 24 hours ago (configurable via memory.dream.minHours) before the next cycle can trigger.">
						<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors">?</span>
					</ConfigTooltip>
				</div>
				<div class="font-medium">{formatTimeSince(dreamState.data.state.lastConsolidatedAt)}</div>
			</div>
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1 inline-flex items-center gap-1">
					{m.dream_lastScan()}
					<ConfigTooltip content="Timestamp of the last session-count scan. The gateway throttles these scans to once every 10 minutes to avoid expensive file-system reads on every session end.">
						<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors">?</span>
					</ConfigTooltip>
				</div>
				<div class="font-medium">{formatTimeSince(dreamState.data.state.lastSessionScanAt)}</div>
			</div>
			<div class="bg-white/[0.03] border border-border rounded-lg p-3">
				<div class="text-muted text-[11px] uppercase tracking-wider mb-1 inline-flex items-center gap-1">
					{m.dream_pendingNotes()}
					<ConfigTooltip content="Number of daily note files (YYYY-MM-DD.md) waiting in memory/. At least 7 notes must accumulate (configurable via memory.dream.fileThreshold) before consolidation triggers. After consolidation, notes are archived to memory/archive/.">
						<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors">?</span>
					</ConfigTooltip>
				</div>
				<div class="font-medium">{dreamState.data.pendingNotes}</div>
			</div>
		</div>

		<!-- History timeline -->
		<div>
			<h3 class="text-muted text-[11px] uppercase tracking-wider mb-2 inline-flex items-center gap-1">
				{m.dream_consolidationHistory()}
				<ConfigTooltip content="Timeline of past dream cycles. Each entry is an LLM-generated summary of the daily notes that were consolidated in that run.">
					<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-[9px] text-muted-foreground cursor-help leading-none hover:text-foreground hover:border-muted transition-colors">?</span>
				</ConfigTooltip>
			</h3>
			{#if dreamState.data.history.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 text-muted py-6">
					<span class="text-[24px] opacity-30">&#x1f4a4;</span>
					<span>{m.dream_noActivityYet()}</span>
					<p class="text-[11px] text-center max-w-xs opacity-60 leading-relaxed">
						{m.dream_noActivityDesc()}
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
			<span>{m.dream_noDataAvailable()}</span>
		</div>
	{/if}
</div>
