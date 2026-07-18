<script lang="ts">
	// Reliability INSIGHTS tab body. Historical analysis over the hub's own
	// `unified_events` copy (via /api/reliability/insights) — turns 215k+ noisy
	// data points into a ranked set of proposed actions + the evidence behind them.
	// Reads a plain hub API, so unlike the live tabs it works even when the gateway
	// WS is down (no `conn.connected` gate).
	import KpiRow, { type KpiItem } from '$lib/components/reliability/KpiRow.svelte';
	import ProposedActionsFeed from '$lib/components/reliability/ProposedActionsFeed.svelte';
	import { Spinner, EmptyState, iconSizes } from '$lib/components/ui';
	import { createInsightsState } from '$lib/state/reliability/insights.svelte';
	import {
		Volume2,
		ShieldCheck,
		BarChart2,
		Lightbulb,
		AlertTriangle,
		TrendingUp,
		ArrowUp,
		ArrowDown,
		Minus,
	} from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	let { serverId, from, to }: { serverId: string; from: number; to: number } = $props();

	const insights = createInsightsState();
	// Reload whenever the server or date window changes.
	$effect(() => {
		if (serverId) insights.load(serverId, from, to);
	});

	const snap = $derived(insights.snapshot);

	const nf = new Intl.NumberFormat('en-US');
	const fmt = (n: number) => nf.format(Math.round(n));
	const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

	// status stem per event severity (critical→destructive, high→warning)
	const SEV: Record<string, { dot: string; text: string }> = {
		critical: { dot: 'bg-destructive', text: 'text-destructive' },
		high: { dot: 'bg-warning', text: 'text-warning' },
	};

	const kpis = $derived.by<KpiItem[]>(() => {
		if (!snap) return [];
		const sn = snap.signalToNoise;
		const hasCrit = snap.proposedActions.some((a) => a.severity === 'critical');
		const actionsColor =
			snap.proposedActions.length === 0
				? 'var(--color-success)'
				: hasCrit
					? 'var(--color-destructive)'
					: 'var(--color-warning)';
		return [
			{
				key: 'noise',
				Icon: Volume2,
				color: 'var(--color-muted-foreground)',
				label: m.reliability_kpiNoiseRatio(),
				value: pct(sn.noisePct),
				subtext: `${fmt(sn.noise)} / ${fmt(sn.total)}`,
			},
			{
				key: 'signal',
				Icon: ShieldCheck,
				color: 'var(--color-info)',
				label: m.reliability_kpiSignalEvents(),
				value: fmt(sn.signal),
				subtext: m.reliability_kpiSignalSub(),
			},
			{
				key: 'total',
				Icon: BarChart2,
				color: 'var(--color-muted-foreground)',
				label: m.reliability_kpiTotalEvents(),
				value: fmt(sn.total),
			},
			{
				key: 'actions',
				Icon: Lightbulb,
				color: actionsColor,
				label: m.reliability_kpiOpenActions(),
				value: snap.proposedActions.length,
			},
			{
				key: 'recurring',
				Icon: AlertTriangle,
				color: snap.topClusters.length ? 'var(--color-warning)' : 'var(--color-success)',
				label: m.reliability_kpiClusters(),
				value: snap.topClusters.length,
			},
			{
				key: 'regressions',
				Icon: TrendingUp,
				color: snap.healthRegressions.length ? 'var(--color-warning)' : 'var(--color-success)',
				label: m.reliability_kpiRegressions(),
				value: snap.healthRegressions.length,
			},
		];
	});

	// largest category volume → bar scale
	const maxCat = $derived(snap?.categoryVolume[0]?.n ?? 1);
</script>

{#if insights.loading && !snap}
	<div class="flex items-center justify-center py-16"><Spinner /></div>
{:else if insights.error && !snap}
	<EmptyState tone="error" icon={AlertTriangle} title={m.reliability_insightsError()} description={insights.error} />
{:else if snap}
	<div class="flex flex-col gap-4">
		<KpiRow items={kpis} cols={6} />

		<!-- Headline: what to do about it -->
		<ProposedActionsFeed actions={snap.proposedActions} />

		<div class="grid lg:grid-cols-2 gap-4">
			<!-- Top signal clusters — the failures behind the actions -->
			<div class="surface-2 rounded-lg overflow-hidden">
				<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
					<span class="text-warning flex"><AlertTriangle size={iconSizes.sm} /></span>
					<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
						>{m.reliability_topClusters()}</span
					>
				</div>
				{#if snap.topClusters.length === 0}
					<EmptyState compact icon={ShieldCheck} title={m.reliability_noClusters()} />
				{:else}
					<ul class="divide-y divide-border/60">
						{#each snap.topClusters.slice(0, 8) as c (c.event + c.msgKey)}
							{@const sev = SEV[c.severity] ?? SEV.high}
							<li class="px-4 py-2.5">
								<div class="flex items-center gap-2">
									<span class="w-1.5 h-1.5 rounded-full shrink-0 {sev.dot}"></span>
									<span class="text-sm font-medium text-foreground truncate">{c.event}</span>
									<span class="ml-auto text-sm font-mono tabular-nums {sev.text}">{fmt(c.n)}</span>
									{#if c.deltaPct !== null}
										<span
											class="flex items-center text-xs tabular-nums {c.deltaPct > 0
												? 'text-destructive'
												: c.deltaPct < 0
													? 'text-success'
													: 'text-muted-strong'}"
										>
											{#if c.deltaPct > 0}<ArrowUp size={iconSizes.xs} />{:else if c.deltaPct < 0}<ArrowDown
													size={iconSizes.xs}
												/>{:else}<Minus size={iconSizes.xs} />{/if}
											{Math.abs(c.deltaPct)}%
										</span>
									{:else}
										<span class="text-xs text-muted-strong">{m.reliability_clusterNew()}</span>
									{/if}
								</div>
								{#if c.msgKey.trim()}
									<p class="text-xs text-muted-strong truncate mt-0.5 pl-3.5">{c.msgKey.trim()}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<!-- Telemetry volume by category — where the noise concentrates (cleanup guide) -->
			<div class="surface-2 rounded-lg overflow-hidden">
				<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
					<span class="text-muted-foreground flex"><BarChart2 size={iconSizes.sm} /></span>
					<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
						>{m.reliability_telemetryByCategory()}</span
					>
				</div>
				<!-- bar-row list contract: container owns tracks, rows use subgrid so bars align -->
				<div class="px-4 py-3 grid grid-cols-[max-content_max-content_1fr] gap-x-3 gap-y-1.5 items-center">
					{#each snap.categoryVolume.slice(0, 10) as cat (cat.category)}
						<div class="grid grid-cols-subgrid col-span-full items-center">
							<span class="text-sm text-foreground truncate">{cat.category}</span>
							<span class="text-xs font-mono tabular-nums text-muted-strong text-right"
								>{fmt(cat.n)} · {pct(cat.pct)}</span
							>
							<div class="h-2 rounded-full bg-bg3/40 overflow-hidden">
								<div
									class="h-full rounded-full bg-info/60"
									style:width={`${Math.max(2, (cat.n / maxCat) * 100)}%`}
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<p class="text-xs text-muted-strong text-right">
			{m.reliability_insightsAsOf()}
			{new Date(snap.generatedAt).toLocaleString()}
		</p>
	</div>
{/if}
