<!--
	Svelte port of paperclip-minion/ui/src/components/ApprovalPayload.tsx.
	Renders an approval `payload` (untyped JSON) in a human-readable form per
	approval `type` (hire_agent, budget_override_required, request_board_approval,
	approve_ceo_strategy, ...). Unknown types fall back to a JsonView grid.
-->
<script lang="ts">
	import JsonView from './JsonView.svelte';
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';

	interface Props {
		type: string;
		payload: Record<string, unknown>;
		/** Hide the primary `title` field — used when the surrounding header already shows it. */
		hidePrimaryTitle?: boolean;
	}

	const { type, payload, hidePrimaryTitle = false }: Props = $props();

	function firstNonEmptyString(...values: unknown[]): string | null {
		for (const value of values) {
			if (typeof value === 'string' && value.trim().length > 0) return value.trim();
		}
		return null;
	}

	function formatCents(cents: number): string {
		return `$${(cents / 100).toFixed(2)}`;
	}

	function isSkillArray(v: unknown): v is string[] {
		return Array.isArray(v) && v.every((x) => typeof x === 'string');
	}
</script>

{#snippet field(label: string, value: unknown)}
	{#if value !== null && value !== undefined && value !== ''}
		<div class="flex items-center gap-2">
			<span class="w-20 sm:w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
			<span>{String(value)}</span>
		</div>
	{/if}
{/snippet}

{#if type === 'hire_agent'}
	<div class="mt-3 space-y-1.5 text-sm">
		<div class="flex items-center gap-2">
			<span class="w-20 sm:w-24 shrink-0 text-xs text-muted-foreground">Name</span>
			<span class="font-medium">{String(payload.name ?? '—')}</span>
		</div>
		{@render field('Role', payload.role)}
		{@render field('Title', payload.title)}
		{@render field('Icon', payload.icon)}
		{#if payload.capabilities}
			<div class="flex items-start gap-2">
				<span class="w-20 sm:w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">Capabilities</span>
				<span class="text-muted-foreground">{String(payload.capabilities)}</span>
			</div>
		{/if}
		{#if payload.adapterType}
			<div class="flex items-center gap-2">
				<span class="w-20 sm:w-24 shrink-0 text-xs text-muted-foreground">Adapter</span>
				<span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{String(payload.adapterType)}</span>
			</div>
		{/if}
		{#if isSkillArray(payload.desiredSkills) && payload.desiredSkills.length > 0}
			<div class="flex items-start gap-2">
				<span class="w-20 sm:w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">Skills</span>
				<div class="flex flex-wrap gap-1.5">
					{#each payload.desiredSkills.filter(Boolean) as skill (skill)}
						<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{skill}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else if type === 'budget_override_required'}
	{@const budgetAmount = typeof payload.budgetAmount === 'number' ? payload.budgetAmount : null}
	{@const observedAmount = typeof payload.observedAmount === 'number' ? payload.observedAmount : null}
	<div class="mt-3 space-y-1.5 text-sm">
		{@render field('Scope', payload.scopeName ?? payload.scopeType)}
		{@render field('Window', payload.windowKind)}
		{@render field('Metric', payload.metric)}
		{#if budgetAmount !== null || observedAmount !== null}
			<div class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
				Limit {budgetAmount !== null ? formatCents(budgetAmount) : '—'} · Observed
				{observedAmount !== null ? formatCents(observedAmount) : '—'}
			</div>
		{/if}
		{#if payload.guidance}
			<p class="text-muted-foreground">{String(payload.guidance)}</p>
		{/if}
	</div>
{:else if type === 'request_board_approval'}
	{@const title = hidePrimaryTitle ? null : firstNonEmptyString(payload.title)}
	{@const summary = firstNonEmptyString(payload.summary)}
	{@const recommendedAction = firstNonEmptyString(payload.recommendedAction)}
	{@const nextActionOnApproval = firstNonEmptyString(payload.nextActionOnApproval)}
	{@const proposedComment = firstNonEmptyString(payload.proposedComment)}
	{@const risks = Array.isArray(payload.risks)
		? payload.risks.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
		: []}
	<div class="mt-4 space-y-3.5 text-sm">
		{#if title}
			<div class="space-y-1">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Title</p>
				<p class="font-medium leading-6 text-foreground">{title}</p>
			</div>
		{/if}
		{#if summary}
			<div class="space-y-1">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Summary</p>
				<div class="leading-6 text-foreground/90"><MarkdownMessage value={summary} /></div>
			</div>
		{/if}
		{#if recommendedAction}
			<div class="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3.5 py-3">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-700">Recommended action</p>
				<p class="mt-1 leading-6 text-foreground">{recommendedAction}</p>
			</div>
		{/if}
		{#if nextActionOnApproval}
			<div class="rounded-lg border border-border/60 bg-background/60 px-3.5 py-3">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">On approval</p>
				<p class="mt-1 leading-6 text-foreground">{nextActionOnApproval}</p>
			</div>
		{/if}
		{#if risks.length > 0}
			<div class="space-y-1.5">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Risks</p>
				<ul class="space-y-1 text-sm text-muted-foreground">
					{#each risks as risk (risk)}
						<li class="flex items-start gap-2">
							<span class="mt-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/60"></span>
							<span class="leading-6">{risk}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if proposedComment}
			<div class="space-y-1.5">
				<p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Proposed comment</p>
				<pre class="max-h-48 overflow-auto rounded-lg border border-border/60 bg-muted/50 px-3.5 py-3 font-mono text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{proposedComment}</pre>
			</div>
		{/if}
	</div>
{:else if type === 'approve_ceo_strategy'}
	{@const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text}
	<div class="mt-3 space-y-1.5 text-sm">
		{@render field('Title', payload.title)}
		{#if plan}
			<div class="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground/90">
				<MarkdownMessage value={String(plan)} />
			</div>
		{:else}
			<JsonView value={payload} />
		{/if}
	</div>
{:else}
	<!-- Unknown approval type: degrade gracefully to a structured key/value grid. -->
	<div class="mt-2"><JsonView value={payload} /></div>
{/if}
