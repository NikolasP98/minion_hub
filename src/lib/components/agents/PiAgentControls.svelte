<script lang="ts">
	import { piAgentState, setThinkingLevel } from '$lib/state/features/pi-agent-state.svelte';
	import { Select } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';

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
		gaugePercent >= 90 ? 'bg-destructive' : gaugePercent >= 70 ? 'bg-warning' : 'bg-success'
	);

</script>

<div class="surface-2 rounded-lg p-4 space-y-3">
	<div class="flex items-start gap-4">
		<!-- Left: Context gauge -->
		<div class="flex-1 min-w-0">
			<div class="text-[11px] font-semibold text-muted mb-1.5">{m.pi_contextWindow()}</div>
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
						{formatTokensK(piAgentState.contextUsage.tokenCount)} / {formatTokensK(piAgentState.contextUsage.contextWindow)} {m.pi_tokens()}
					{:else}
						{formatTokensK(piAgentState.contextUsage.tokenCount)} {m.pi_tokensWindowUnknown()}
					{/if}
				</div>
				<div class="text-[10px] text-muted">
					{m.pi_messagesCompactions({ messages: piAgentState.contextUsage.messageCount, compactions: piAgentState.contextUsage.compactionCount })}
				</div>
			{:else}
				<div class="text-[10px] text-muted">{m.pi_noActiveSession()}</div>
			{/if}
		</div>

		<!-- Right: Thinking control -->
		<div class="shrink-0">
			<div class="text-[11px] font-semibold text-muted mb-1.5">{m.pi_thinking()}</div>
			{#if piAgentState.thinkingLevels.length > 0}
				<Select
					size="xs"
					value={piAgentState.currentThinkingLevel ?? ''}
					onchange={(v) => setThinkingLevel(String(v))}
				>
					{#each piAgentState.thinkingLevels as level (level)}
						<option value={level}>{level}</option>
					{/each}
				</Select>
			{:else}
				<Select size="xs" disabled>
					<option>N/A</option>
				</Select>
			{/if}
		</div>
	</div>

	<!-- Bottom row: Session stats -->
	<div class="flex items-center gap-3 text-[10px] text-muted border-t border-border pt-2">
		{#if piAgentState.sessionStats}
			<span>{m.pi_statIn()}: <span class="text-foreground">{formatTokens(piAgentState.sessionStats.inputTokens)}</span></span>
			<span class="text-border">|</span>
			<span>{m.pi_statOut()}: <span class="text-foreground">{formatTokens(piAgentState.sessionStats.outputTokens)}</span></span>
			<span class="text-border">|</span>
			<span>{m.pi_statTools()}: <span class="text-foreground">{piAgentState.sessionStats.toolCallCount}</span></span>
			<span class="text-border">|</span>
			<span>{m.pi_statTurns()}: <span class="text-foreground">{piAgentState.sessionStats.turnCount}</span></span>
		{:else}
			<span>{m.pi_statIn()}: <span class="text-foreground">&mdash;</span></span>
			<span class="text-border">|</span>
			<span>{m.pi_statOut()}: <span class="text-foreground">&mdash;</span></span>
			<span class="text-border">|</span>
			<span>{m.pi_statTools()}: <span class="text-foreground">&mdash;</span></span>
		{/if}
	</div>
</div>
