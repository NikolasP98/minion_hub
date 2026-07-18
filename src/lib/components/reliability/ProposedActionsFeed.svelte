<script lang="ts">
	// The "outcomes" surface: ranked, evidence-backed actions derived from the
	// telemetry corpus. v1 cards come from server-side heuristic detectors
	// (insights.service.ts); the same ProposedAction shape is what a future
	// log-reading agent would emit, so this feed doesn't change when a real agent
	// replaces the heuristics. Dismissal is per-browser localStorage (honest v1
	// ceiling) — upgrade to a server `reliability_actions` table when an agent
	// starts writing/acting on these (needs a packages/db schema bump).
	import { AlertTriangle, TrendingUp, DollarSign, RefreshCw, Volume2, X, Lightbulb } from 'lucide-svelte';
	import { Button, EmptyState, iconSizes } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import type { ProposedAction, DetectorKind } from '$lib/state/reliability/insights.svelte';

	let { actions = [] }: { actions?: ProposedAction[] } = $props();

	const STORAGE_KEY = 'minion-hub-reliability-dismissed-actions';

	function loadDismissed(): Set<string> {
		if (typeof localStorage === 'undefined') return new Set();
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return new Set(raw ? (JSON.parse(raw) as string[]) : []);
		} catch {
			return new Set();
		}
	}
	let dismissed = $state<Set<string>>(loadDismissed());

	function dismiss(id: string) {
		const next = new Set(dismissed);
		next.add(id);
		dismissed = next;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
		} catch {
			/* private mode / quota — dismissal is best-effort */
		}
	}

	const visible = $derived(actions.filter((a) => !dismissed.has(a.id)));

	// detector → lucide icon
	const ICONS: Record<DetectorKind, typeof AlertTriangle> = {
		recurring_failure: AlertTriangle,
		health_regression: TrendingUp,
		cost_outlier: DollarSign,
		reconnect_storm: RefreshCw,
		noise_source: Volume2,
	};
	// action severity → STATIC status-token classes (never accent for a status
	// level; critical maps to the `destructive` utility, warning/info to their
	// own). Static strings so Tailwind JIT emits them (no interpolated classes).
	const CARD: Record<ProposedAction['severity'], { medallion: string; chip: string; fix: string }> = {
		critical: {
			medallion: 'bg-destructive/15 text-destructive border-destructive/30',
			chip: 'bg-destructive/15 text-destructive',
			fix: 'text-destructive',
		},
		warning: {
			medallion: 'bg-warning/15 text-warning border-warning/30',
			chip: 'bg-warning/15 text-warning',
			fix: 'text-warning',
		},
		info: {
			medallion: 'bg-info/15 text-info border-info/30',
			chip: 'bg-info/15 text-info',
			fix: 'text-info',
		},
	};
</script>

<div class="surface-2 rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<span class="text-info flex"><Lightbulb size={iconSizes.sm} /></span>
		<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
			>{m.reliability_proposedActions()}</span
		>
		{#if visible.length}
			<span class="ml-auto text-xs tabular-nums text-muted-strong">{visible.length}</span>
		{/if}
	</div>

	{#if visible.length === 0}
		<EmptyState
			compact
			icon={Lightbulb}
			title={m.reliability_insightsClearTitle()}
			description={m.reliability_insightsClearBody()}
		/>
	{:else}
		<ul class="divide-y divide-border/60">
			{#each visible as a (a.id)}
				{@const Icon = ICONS[a.detector]}
				{@const c = CARD[a.severity]}
				<li class="flex items-start gap-3 px-4 py-3">
					<span class="mt-0.5 shrink-0 rounded-md p-1.5 border flex {c.medallion}">
						<Icon size={iconSizes.sm} />
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline gap-2">
							<span class="text-sm font-semibold text-foreground truncate">{a.title}</span>
							<span class="shrink-0 text-xs uppercase tracking-wide px-1.5 py-0.5 rounded {c.chip}"
								>{a.severity}</span
							>
						</div>
						<p class="text-xs text-muted-strong mt-0.5 leading-snug">{a.evidence}</p>
						<p class="text-xs text-muted-foreground mt-1 leading-snug">
							<span class="font-medium {c.fix}">{m.reliability_suggestedFix()}:</span>
							{a.suggestedFix}
						</p>
					</div>
					<Button
						variant="ghost"
						size="xs"
						shape="icon"
						class="shrink-0 -mr-1 -mt-1"
						onclick={() => dismiss(a.id)}
						aria-label={m.common_dismiss()}
					>
						<X size={iconSizes.sm} />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
