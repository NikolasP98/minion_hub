<script lang="ts">
	import { piAgentState, setThinkingLevel } from '$lib/state/features/pi-agent-state.svelte';

	let { agentId }: { agentId: string } = $props();

	function formatTokens(n: number): string {
		if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
		return String(n);
	}

	function formatTokensK(n: number | null): string {
		if (n == null) return '?';
		return (n / 1000).toFixed(0) + 'k';
	}

	const gaugePercent = $derived(piAgentState.contextUsage?.percent ?? 0);
	const gaugeColor = $derived(
		gaugePercent >= 90 ? 'bg-red-500' : gaugePercent >= 70 ? 'bg-yellow-500' : 'bg-emerald-500'
	);

	function onThinkingChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		setThinkingLevel(target.value);
	}
</script>

<div class="bg-bg2 border border-border rounded-lg p-4 space-y-3">
	<div class="flex items-start gap-4">
		<!-- Left: Context gauge -->
		<div class="flex-1 min-w-0">
			<div class="text-[11px] font-semibold text-muted mb-1.5">Context Window</div>
			{#if piAgentState.contextUsage}
				<!-- Progress bar -->
				<div class="w-full h-2 bg-bg3 rounded-full overflow-hidden">
					<div
						class="h-full rounded-full transition-all duration-300 {gaugeColor}"
						style="width: {Math.min(gaugePercent, 100)}%"
					></div>
				</div>
				<!-- Token counts -->
				<div class="mt-1 text-[10px] text-foreground">
					{#if piAgentState.contextUsage.contextWindow != null}
						{formatTokensK(piAgentState.contextUsage.tokenCount)} / {formatTokensK(piAgentState.contextUsage.contextWindow)} tokens
					{:else}
						{formatTokensK(piAgentState.contextUsage.tokenCount)} tokens (window unknown)
					{/if}
				</div>
				<div class="text-[10px] text-muted">
					{piAgentState.contextUsage.messageCount} messages, {piAgentState.contextUsage.compactionCount} compactions
				</div>
			{:else}
				<div class="text-[10px] text-muted">No active session</div>
			{/if}
		</div>

		<!-- Right: Thinking control -->
		<div class="shrink-0">
			<div class="text-[11px] font-semibold text-muted mb-1.5">Thinking</div>
			{#if piAgentState.thinkingLevels.length > 0}
				<select
					class="text-[11px] bg-bg3 border border-border rounded px-2 py-1 text-foreground cursor-pointer"
					value={piAgentState.currentThinkingLevel ?? ''}
					onchange={onThinkingChange}
				>
					{#each piAgentState.thinkingLevels as level}
						<option value={level}>{level}</option>
					{/each}
				</select>
			{:else}
				<select
					class="text-[11px] bg-bg3 border border-border rounded px-2 py-1 text-muted"
					disabled
				>
					<option>N/A</option>
				</select>
			{/if}
		</div>
	</div>

	<!-- Bottom row: Session stats -->
	<div class="flex items-center gap-3 text-[10px] text-muted border-t border-border pt-2">
		{#if piAgentState.sessionStats}
			<span>In: <span class="text-foreground">{formatTokens(piAgentState.sessionStats.inputTokens)}</span></span>
			<span class="text-border">|</span>
			<span>Out: <span class="text-foreground">{formatTokens(piAgentState.sessionStats.outputTokens)}</span></span>
			<span class="text-border">|</span>
			<span>Tools: <span class="text-foreground">{piAgentState.sessionStats.toolCallCount}</span></span>
			<span class="text-border">|</span>
			<span>Turns: <span class="text-foreground">{piAgentState.sessionStats.turnCount}</span></span>
		{:else}
			<span>In: <span class="text-foreground">&mdash;</span></span>
			<span class="text-border">|</span>
			<span>Out: <span class="text-foreground">&mdash;</span></span>
			<span class="text-border">|</span>
			<span>Tools: <span class="text-foreground">&mdash;</span></span>
		{/if}
	</div>
</div>
