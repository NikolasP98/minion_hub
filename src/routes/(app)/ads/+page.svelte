<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Megaphone, ExternalLink } from 'lucide-svelte';
	import { PageHeader, Button, EmptyState } from '$lib/components/ui';
	import Chart from '$lib/components/charts/Chart.svelte';
	import { chartColors } from '$lib/utils/chart-colors';
	import type { EChartsOption } from 'echarts';

	let { data }: { data: PageData } = $props();

	const c = $derived(chartColors());

	// svelte-ignore state_referenced_locally
	let fromDate = $state(data.range.from);
	// svelte-ignore state_referenced_locally
	let toDate = $state(data.range.to);

	function navigate(f: string, t: string) {
		const p = new URLSearchParams();
		if (f) p.set('from', f);
		if (t) p.set('to', t);
		goto(`/ads?${p}`, { keepFocus: true, noScroll: true });
	}

	function preset30d() {
		const to = new Date();
		const from = new Date();
		from.setDate(from.getDate() - 30);
		fromDate = from.toISOString().slice(0, 10);
		toDate = to.toISOString().slice(0, 10);
		navigate(fromDate, toDate);
	}

	function fmtMoney(v: number): string {
		return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}
	function fmtDelta(v: number | null): string {
		if (v === null) return '—';
		return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
	}

	const kpis = $derived(
		data.kpis
			? [
					{ id: 'spend', label: m.ads_kpi_spend(), value: fmtMoney(data.kpis.spend), delta: data.kpis.deltaPct.spend },
					{
						id: 'impressions',
						label: m.ads_kpi_impressions(),
						value: fmtInt(data.kpis.impressions),
						delta: data.kpis.deltaPct.impressions,
					},
					{ id: 'reach', label: m.ads_kpi_reach(), value: fmtInt(data.kpis.reach), delta: data.kpis.deltaPct.reach },
					{ id: 'clicks', label: m.ads_kpi_clicks(), value: fmtInt(data.kpis.clicks), delta: data.kpis.deltaPct.clicks },
					{ id: 'ctr', label: m.ads_kpi_ctr(), value: `${data.kpis.ctr.toFixed(2)}%`, delta: data.kpis.deltaPct.ctr },
					{ id: 'cpc', label: m.ads_kpi_cpc(), value: fmtMoney(data.kpis.cpc), delta: data.kpis.deltaPct.cpc },
				]
			: [],
	);

	const spendOpts = $derived({
		grid: { left: 8, right: 18, top: 16, bottom: 30, containLabel: true },
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', data: data.series.map((r) => r.date), axisLabel: { hideOverlap: true } },
		yAxis: { type: 'value' },
		series: [
			{
				name: m.ads_kpi_spend(),
				type: 'line',
				areaStyle: { color: c.info, opacity: 0.25 },
				lineStyle: { color: c.info },
				itemStyle: { color: c.info },
				smooth: true,
				data: data.series.map((r) => Math.round(r.spend * 100) / 100),
			},
		],
	} satisfies EChartsOption);

	const campaignOpts = $derived((() => {
		const sorted = [...data.campaigns].sort((a, b) => b.spend - a.spend).slice(0, 10);
		return {
			grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
			tooltip: { trigger: 'axis' },
			yAxis: { type: 'category', data: sorted.map((r) => r.campaignName ?? r.campaignId ?? '—'), inverse: true },
			xAxis: { type: 'value' },
			series: [{ type: 'bar', itemStyle: { color: c.accent }, data: sorted.map((r) => Math.round(r.spend * 100) / 100) }],
		} satisfies EChartsOption;
	})());

	// Post metric map has no fixed schema (IG metric names drift) — show
	// whichever of these common keys are present, in priority order.
	const POST_METRIC_PRIORITY = ['post_impressions', 'impressions', 'views', 'reach', 'post_clicks', 'likes', 'comments', 'shares', 'saved'];
	function topMetrics(metrics: Record<string, number>): Array<[string, number]> {
		const keys = POST_METRIC_PRIORITY.filter((k) => k in metrics);
		const rest = Object.keys(metrics).filter((k) => !POST_METRIC_PRIORITY.includes(k));
		return [...keys, ...rest].slice(0, 3).map((k) => [k, metrics[k]]);
	}
</script>

<svelte:head><title>{m.nav_ads()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_ads()} subtitle={m.ads_dashboard_subtitle()}>
		{#snippet leading()}<Megaphone size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		<div class="w-full max-w-6xl mx-auto">
			{#if !data.hasConnection}
				<EmptyState icon={Megaphone} title={m.ads_empty_title()} description={m.ads_empty_dashboard_desc()}>
					{#snippet action()}
						<Button variant="primary" size="sm" href="/api/meta/oauth/start">{m.ads_connect_meta()}</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<div class="period-controls">
					<div class="date-range">
						<label class="date-label">
							<span>{m.ads_date_from()}</span>
							<input type="date" bind:value={fromDate} oninput={() => navigate(fromDate, toDate)} />
						</label>
						<label class="date-label">
							<span>{m.ads_date_to()}</span>
							<input type="date" bind:value={toDate} oninput={() => navigate(fromDate, toDate)} />
						</label>
					</div>
					<button class="preset" onclick={preset30d}>{m.ads_preset_30d()}</button>
				</div>

				{#if data.kpis && data.kpis.spend === 0 && data.kpis.impressions === 0}
					<p class="t-caption mt-2 mb-2">{m.ads_dashboard_unsynced()}</p>
				{/if}

				<div class="kpi-grid mt-3">
					{#each kpis as k (k.id)}
						<div class="kpi">
							<div class="kpi-val">{k.value}</div>
							<div class="kpi-label">{k.label}</div>
							<div class="kpi-delta" class:pos={k.delta !== null && k.delta >= 0} class:neg={k.delta !== null && k.delta < 0}>
								{fmtDelta(k.delta)}
							</div>
						</div>
					{/each}
				</div>

				<div class="charts-grid mt-3">
					<div class="card">
						<div class="card-h">{m.ads_chart_spend_title()}</div>
						<Chart options={spendOpts} height="280px" />
					</div>
					<div class="card">
						<div class="card-h">{m.ads_chart_campaign_title()}</div>
						<Chart options={campaignOpts} height="280px" />
					</div>
				</div>

				<div class="card mt-3">
					<div class="card-h">{m.ads_top_posts_title()}</div>
					{#if data.posts.length === 0}
						<p class="t-caption">{m.ads_no_posts()}</p>
					{:else}
						<ul class="post-list">
							{#each data.posts as post (post.postId)}
								<li class="post-row">
									<span class="post-platform" data-platform={post.platform ?? ''}>{post.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
									<span class="post-caption truncate">{post.caption ?? '—'}</span>
									<span class="post-metrics t-caption">
										{#each topMetrics(post.metrics) as [key, value] (key)}
											<span class="metric">{key}: {fmtInt(value)}</span>
										{/each}
									</span>
									{#if post.permalink}
										<a class="post-link" href={post.permalink} target="_blank" rel="noreferrer">
											<ExternalLink size={12} />
										</a>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.period-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.date-range {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.date-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		white-space: nowrap;
	}
	.date-label input {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--color-card);
		color: var(--color-foreground);
		font-size: 0.82rem;
		color-scheme: dark;
	}
	.preset {
		padding: 0.3rem 0.65rem;
		font-size: 0.75rem;
		background: transparent;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background 0.15s, color 0.15s;
	}
	.preset:hover {
		background: var(--color-card);
		color: inherit;
	}
	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.6rem;
	}
	.kpi {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0.85rem 1rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
	}
	.kpi-val {
		font-size: 1.4rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		margin-top: 0.15rem;
	}
	.kpi-delta {
		font-size: 0.72rem;
		margin-top: 0.25rem;
		color: var(--color-muted-foreground);
	}
	.kpi-delta.pos {
		color: var(--color-success, #22c55e);
	}
	.kpi-delta.neg {
		color: var(--color-destructive, #ef4444);
	}
	.charts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
		gap: 0.75rem;
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		margin-bottom: 0.8rem;
	}
	.post-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.post-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--hairline);
	}
	.post-row:last-child {
		border-bottom: none;
	}
	.post-platform {
		flex-shrink: 0;
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-platform[data-platform='ig'] {
		background: color-mix(in srgb, var(--color-pink, #ec4899) 15%, transparent);
		color: var(--color-pink, #ec4899);
	}
	.post-platform[data-platform='fb'] {
		background: color-mix(in srgb, var(--color-info, #3b82f6) 15%, transparent);
		color: var(--color-info, #3b82f6);
	}
	.post-caption {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
	}
	.post-metrics {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.post-link {
		flex-shrink: 0;
		color: var(--color-muted-foreground);
		display: flex;
	}
	.post-link:hover {
		color: var(--color-accent);
	}
</style>
