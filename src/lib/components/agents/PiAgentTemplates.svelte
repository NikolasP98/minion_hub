<script lang="ts">
  import { Button } from '$lib/components/ui';
import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
	import { sendRequest } from '$lib/services/gateway.svelte';
	import * as m from '$lib/paraglide/messages';

	let expandedName = $state<string | null>(null);
	let templateDetails = $state<Map<string, Record<string, unknown>>>(new Map());
	let detailLoading = $state(false);
	let showFullPrompt = $state<string | null>(null);

	function formatRelativeTime(ts: number | null): string {
		if (ts == null) return m.pi_tmplNever();
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
		<Button variant="ghost"
			type="button"
			class="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[var(--color-text-primary)]/[0.03] transition-colors cursor-pointer text-left border-0 bg-transparent border-b border-border/30"
			onclick={() => toggleExpand(tmpl.name)}
		>
			<!-- Template name -->
			<span class="text-[length:var(--font-size-caption)] font-semibold text-foreground truncate">{tmpl.name}</span>

			<!-- Model badge -->
			{#if tmpl.model}
				<span class="text-[length:var(--font-size-telemetry)] text-muted-strong truncate max-w-20">{tmpl.model}</span>
			{/if}

			<!-- Spacer -->
			<span class="flex-1"></span>

			<!-- Usage count -->
			<span class="text-[length:var(--font-size-telemetry)] text-muted-strong">{m.pi_tmplUses({ count: tmpl.spawnCount })}</span>

			<!-- Last used -->
			<span class="text-[length:var(--font-size-telemetry)] text-muted-strong">{formatRelativeTime(tmpl.lastUsedAt)}</span>

			<!-- Expand indicator -->
			<span class="text-[length:var(--font-size-telemetry)] text-muted-strong">{expandedName === tmpl.name ? '\u25B2' : '\u25BC'}</span>
		</Button>

		<!-- Expanded detail -->
		{#if expandedName === tmpl.name}
			<div class="px-3 py-2 bg-bg2/50 border-b border-border/30 text-[length:var(--font-size-telemetry)]">
				{#if detailLoading && !templateDetails.has(tmpl.name)}
					<p class="text-muted">{m.pi_orchLoadingDetails()}</p>
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
									<span class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded bg-accent/10 text-accent/60">{tag}</span>
								{/each}
							</div>
						{/if}

						<!-- Metadata row -->
						<div class="flex items-center gap-3 text-muted flex-wrap">
							<span>{m.pi_tmplSource()}: <span class="text-foreground">{tmpl.source}</span></span>
							{#if tmpl.version}
								<span>{m.pi_tmplVersion()}: <span class="text-foreground">{tmpl.version}</span></span>
							{/if}
						</div>

						<!-- Detail from API -->
						{#if getDetail(tmpl.name)}
							<div class="flex items-center gap-3 text-muted flex-wrap">
								{#if getDetail(tmpl.name)?.thinkingLevel}
									<span>{m.pi_tmplThinking()}: <span class="text-foreground">{getDetail(tmpl.name)?.thinkingLevel}</span></span>
								{/if}
								{#if getDetail(tmpl.name)?.timeout}
									<span>{m.pi_tmplTimeout()}: <span class="text-foreground">{getDetail(tmpl.name)?.timeout}s</span></span>
								{/if}
								{#if getDetail(tmpl.name)?.cleanup}
									<span>{m.pi_tmplCleanup()}: <span class="text-foreground">{getDetail(tmpl.name)?.cleanup}</span></span>
								{/if}
							</div>

							<!-- Tool restrictions -->
							{#if getDetail(tmpl.name)?.toolRestrictions}
								<div class="text-muted">
									{m.pi_tmplTools()}: <span class="text-foreground">{getToolRestrictionsText(getDetail(tmpl.name)!)}</span>
								</div>
							{/if}

							<!-- System prompt excerpt -->
							{#if getSystemPromptLines(getDetail(tmpl.name)!).length > 0}
								<div class="mt-1">
									<div class="text-muted mb-0.5">{m.pi_tmplSystemPrompt()}:</div>
									<pre class="text-[length:var(--font-size-telemetry)] text-foreground/70 bg-bg3 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{#if showFullPrompt === tmpl.name}{getSystemPromptLines(getDetail(tmpl.name)!).join('\n')}{:else}{getSystemPromptLines(getDetail(tmpl.name)!).slice(0, 5).join('\n')}{/if}</pre>
									{#if getSystemPromptLines(getDetail(tmpl.name)!).length > 5}
										<Button variant="ghost"
											type="button"
											class="text-[length:var(--font-size-telemetry)] text-accent hover:text-accent/80 mt-0.5 bg-transparent border-0 cursor-pointer p-0"
											onclick={(e: MouseEvent) => { e.stopPropagation(); showFullPrompt = showFullPrompt === tmpl.name ? null : tmpl.name; }}
										>
											{showFullPrompt === tmpl.name ? m.pi_tmplShowLess() : m.pi_tmplShowFull({ lines: getSystemPromptLines(getDetail(tmpl.name)!).length })}
										</Button>
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
		<p class="text-[length:var(--font-size-caption)] text-muted px-2 py-3">{m.pi_tmplNone()}</p>
	{/if}
</div>
