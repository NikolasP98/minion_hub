<script lang="ts">
	import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
	import { sendRequest } from '$lib/services/gateway.svelte';

	let expandedName = $state<string | null>(null);
	let templateDetails = $state<Map<string, Record<string, unknown>>>(new Map());
	let detailLoading = $state(false);
	let showFullPrompt = $state<string | null>(null);

	function formatRelativeTime(ts: number | null): string {
		if (ts == null) return 'never';
		const ms = Date.now() - ts;
		if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
		if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
		if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
		return `${Math.round(ms / 86_400_000)}d ago`;
	}

	async function toggleExpand(name: string) {
		if (expandedName === name) {
			expandedName = null;
			return;
		}

		expandedName = name;

		// Fetch detail if not cached
		if (!templateDetails.has(name)) {
			detailLoading = true;
			try {
				const result = await sendRequest('templates.get', { name });
				const updated = new Map(templateDetails);
				updated.set(name, result as Record<string, unknown>);
				templateDetails = updated;
			} catch {
				// Detail fetch failed, proceed without
			} finally {
				detailLoading = false;
			}
		}
	}

	function getDetail(name: string): Record<string, unknown> | undefined {
		return templateDetails.get(name);
	}

	function getSystemPromptLines(detail: Record<string, unknown>): string[] {
		const prompt = (detail.systemPrompt ?? detail.system_prompt ?? '') as string;
		if (!prompt) return [];
		return prompt.split('\n');
	}

	function getToolRestrictionsText(detail: Record<string, unknown>): string {
		const restrictions = detail.toolRestrictions as Record<string, unknown> | undefined;
		if (!restrictions) return '';
		if (restrictions.allowOnly) return 'allow only: ' + (restrictions.allowOnly as string[]).join(', ');
		if (restrictions.deny) return 'deny: ' + (restrictions.deny as string[]).join(', ');
		return 'unrestricted';
	}
</script>

<div class="flex flex-col gap-0.5">
	{#each piAgentState.templates as tmpl (tmpl.name)}
		<!-- Collapsed row -->
		<button
			type="button"
			class="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-white/[0.03] transition-colors cursor-pointer text-left border-0 bg-transparent border-b border-border/30"
			onclick={() => toggleExpand(tmpl.name)}
		>
			<!-- Template name -->
			<span class="text-[11px] font-semibold text-foreground truncate">{tmpl.name}</span>

			<!-- Model badge -->
			{#if tmpl.model}
				<span class="text-[9px] text-muted/50 truncate max-w-20">{tmpl.model}</span>
			{/if}

			<!-- Spacer -->
			<span class="flex-1"></span>

			<!-- Usage count -->
			<span class="text-[9px] text-muted/50">{tmpl.spawnCount} uses</span>

			<!-- Last used -->
			<span class="text-[9px] text-muted/40">{formatRelativeTime(tmpl.lastUsedAt)}</span>

			<!-- Expand indicator -->
			<span class="text-[9px] text-muted/40">{expandedName === tmpl.name ? '\u25B2' : '\u25BC'}</span>
		</button>

		<!-- Expanded detail -->
		{#if expandedName === tmpl.name}
			<div class="px-3 py-2 bg-bg2/50 border-b border-border/30 text-[10px]">
				{#if detailLoading && !templateDetails.has(tmpl.name)}
					<p class="text-muted">Loading details...</p>
				{:else}
					<div class="flex flex-col gap-1.5">
						<!-- Description -->
						{#if tmpl.description}
							<p class="text-foreground">{tmpl.description}</p>
						{/if}

						<!-- Tags -->
						{#if tmpl.tags.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each tmpl.tags as tag}
									<span class="text-[8px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/60">{tag}</span>
								{/each}
							</div>
						{/if}

						<!-- Metadata row -->
						<div class="flex items-center gap-3 text-muted flex-wrap">
							<span>Source: <span class="text-foreground">{tmpl.source}</span></span>
							{#if tmpl.version}
								<span>Version: <span class="text-foreground">{tmpl.version}</span></span>
							{/if}
						</div>

						<!-- Detail from API -->
						{#if getDetail(tmpl.name)}
							<div class="flex items-center gap-3 text-muted flex-wrap">
								{#if getDetail(tmpl.name)?.thinkingLevel}
									<span>Thinking: <span class="text-foreground">{getDetail(tmpl.name)?.thinkingLevel}</span></span>
								{/if}
								{#if getDetail(tmpl.name)?.timeout}
									<span>Timeout: <span class="text-foreground">{getDetail(tmpl.name)?.timeout}s</span></span>
								{/if}
								{#if getDetail(tmpl.name)?.cleanup}
									<span>Cleanup: <span class="text-foreground">{getDetail(tmpl.name)?.cleanup}</span></span>
								{/if}
							</div>

							<!-- Tool restrictions -->
							{#if getDetail(tmpl.name)?.toolRestrictions}
								<div class="text-muted">
									Tools: <span class="text-foreground">{getToolRestrictionsText(getDetail(tmpl.name)!)}</span>
								</div>
							{/if}

							<!-- System prompt excerpt -->
							{#if getSystemPromptLines(getDetail(tmpl.name)!).length > 0}
								<div class="mt-1">
									<div class="text-muted mb-0.5">System prompt:</div>
									<pre class="text-[9px] text-foreground/70 bg-bg3 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{#if showFullPrompt === tmpl.name}{getSystemPromptLines(getDetail(tmpl.name)!).join('\n')}{:else}{getSystemPromptLines(getDetail(tmpl.name)!).slice(0, 5).join('\n')}{/if}</pre>
									{#if getSystemPromptLines(getDetail(tmpl.name)!).length > 5}
										<button
											type="button"
											class="text-[9px] text-accent hover:text-accent/80 mt-0.5 bg-transparent border-0 cursor-pointer p-0"
											onclick={(e: MouseEvent) => { e.stopPropagation(); showFullPrompt = showFullPrompt === tmpl.name ? null : tmpl.name; }}
										>
											{showFullPrompt === tmpl.name ? 'Show less' : `Show full prompt (${getSystemPromptLines(getDetail(tmpl.name)!).length} lines)`}
										</button>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
	{#if piAgentState.templates.length === 0}
		<p class="text-[11px] text-muted px-2 py-3">No templates loaded.</p>
	{/if}
</div>
