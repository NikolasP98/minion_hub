<script lang="ts">
	import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
	import { sendRequest } from '$lib/services/gateway.svelte';

	let expandedId = $state<string | null>(null);
	let expandedDetail = $state<Record<string, unknown> | null>(null);
	let detailLoading = $state(false);

	function formatRelativeTime(ts: number): string {
		const ms = Date.now() - ts;
		if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
		if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
		if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
		return `${Math.round(ms / 86_400_000)}d ago`;
	}

	function formatDurationMs(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
		return `${(ms / 3_600_000).toFixed(1)}h`;
	}

	function formatTimestamp(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	const orchStatusColor: Record<string, string> = {
		running: 'bg-yellow-400',
		completed: 'bg-emerald-400',
		failed: 'bg-red-400',
		interrupted: 'bg-red-400'
	};

	function getDetailTasks(detail: Record<string, unknown> | null): Array<Record<string, unknown>> {
		if (!detail || !Array.isArray(detail.tasks)) return [];
		return detail.tasks as Array<Record<string, unknown>>;
	}

	async function toggleExpand(orchId: string) {
		if (expandedId === orchId) {
			expandedId = null;
			expandedDetail = null;
			return;
		}

		expandedId = orchId;
		expandedDetail = null;
		detailLoading = true;

		try {
			const result = await sendRequest('pi-agent.orchestrations.get', {
				orchestrationId: orchId,
				agentId: piAgentState.agentId
			});
			expandedDetail = result as Record<string, unknown>;
		} catch {
			expandedDetail = null;
		} finally {
			detailLoading = false;
		}
	}
</script>

<div class="flex flex-col gap-0.5">
	{#each piAgentState.orchestrations as orch (orch.orchestrationId)}
		<!-- Collapsed row -->
		<button
			type="button"
			class="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-white/[0.03] transition-colors cursor-pointer text-left border-0 bg-transparent border-b border-border/30"
			onclick={() => toggleExpand(orch.orchestrationId)}
		>
			<!-- Status dot -->
			<span class="w-1.5 h-1.5 rounded-full shrink-0 {orchStatusColor[orch.status] ?? 'bg-zinc-500'}"></span>

			<!-- Orchestration ID (short) -->
			<span class="text-[10px] font-mono text-muted/70">{orch.orchestrationId.slice(0, 8)}</span>

			<!-- Mode badge -->
			<span class="text-[8px] px-1 py-0.5 rounded bg-accent/10 text-accent/60">{orch.mode}</span>

			<!-- Task count -->
			<span class="text-[9px] text-muted/50">{orch.taskCount} tasks</span>

			<!-- Spacer -->
			<span class="flex-1"></span>

			<!-- Duration -->
			{#if orch.completedAt}
				<span class="text-[9px] text-muted/40 font-mono">{formatDurationMs(orch.completedAt - orch.startedAt)}</span>
			{/if}

			<!-- Relative time -->
			<span class="text-[9px] text-muted/40">{formatRelativeTime(orch.startedAt)}</span>

			<!-- Expand indicator -->
			<span class="text-[9px] text-muted/40">{expandedId === orch.orchestrationId ? '\u25B2' : '\u25BC'}</span>
		</button>

		<!-- Expanded detail -->
		{#if expandedId === orch.orchestrationId}
			<div class="px-3 py-2 bg-bg2/50 border-b border-border/30 text-[10px]">
				{#if detailLoading}
					<p class="text-muted">Loading details...</p>
				{:else if expandedDetail}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center gap-3 text-muted">
							<span>ID: <span class="text-foreground font-mono">{orch.orchestrationId}</span></span>
						</div>
						<div class="flex items-center gap-3 text-muted">
							<span>Started: <span class="text-foreground">{formatTimestamp(orch.startedAt)}</span></span>
							{#if orch.completedAt}
								<span>Duration: <span class="text-foreground">{formatDurationMs(orch.completedAt - orch.startedAt)}</span></span>
							{/if}
						</div>

						<!-- Task list from detail -->
						{#if getDetailTasks(expandedDetail).length > 0}
							<table class="w-full text-[9px] mt-1">
								<thead>
									<tr class="text-muted border-b border-border/30">
										<th class="text-left py-0.5 pr-2">#</th>
										<th class="text-left py-0.5 pr-2">Label</th>
										<th class="text-left py-0.5 pr-2">Status</th>
										<th class="text-right py-0.5 pr-2">Duration</th>
										<th class="text-right py-0.5">Tokens</th>
									</tr>
								</thead>
								<tbody>
									{#each getDetailTasks(expandedDetail) as task, i}
										<tr class="border-b border-border/20 text-foreground">
											<td class="py-0.5 pr-2 text-muted">{i + 1}</td>
											<td class="py-0.5 pr-2 truncate max-w-32">{task.label ?? task.template ?? '-'}</td>
											<td class="py-0.5 pr-2">
												<span class="px-1 py-0.5 rounded {task.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : task.status === 'failed' ? 'bg-red-500/20 text-red-400' : task.status === 'running' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-zinc-500/20 text-zinc-400'}">
													{task.status ?? 'pending'}
												</span>
											</td>
											<td class="py-0.5 pr-2 text-right font-mono text-muted">
												{#if typeof task.duration === 'number'}
													{formatDurationMs(task.duration)}
												{:else}
													-
												{/if}
											</td>
											<td class="py-0.5 text-right font-mono text-muted">
												{#if typeof task.tokens === 'number'}
													{task.tokens.toLocaleString()}
												{:else}
													-
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				{:else}
					<p class="text-muted">Failed to load details.</p>
				{/if}
			</div>
		{/if}
	{/each}
	{#if piAgentState.orchestrations.length === 0}
		<p class="text-[11px] text-muted px-2 py-3">No orchestrations yet.</p>
	{/if}
</div>
