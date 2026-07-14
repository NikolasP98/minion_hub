<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Megaphone, ExternalLink } from 'lucide-svelte';
	import { PageHeader, Button, EmptyState } from '$lib/components/ui';
	import Chart from '$lib/components/charts/Chart.svelte';
	import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
	import { canAct } from '$lib/access/can.svelte';
	import { isAdmin } from '$lib/state/features/user.svelte';
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
		goto(`/socials?${p}`, { keepFocus: true, noScroll: true });
	}

	function preset30d() {
		const to = new Date();
		const from = new Date();
		from.setDate(from.getDate() - 30);
		fromDate = from.toISOString().slice(0, 10);
		toDate = to.toISOString().slice(0, 10);
		navigate(fromDate, toDate);
	}

	function presetAll() {
		if (!data.extent.minDate || !data.extent.maxDate) return;
		// range.to is exclusive — bump maxDate by 1 day so the last day of data is included.
		const to = new Date(`${data.extent.maxDate}T00:00:00Z`);
		to.setUTCDate(to.getUTCDate() + 1);
		fromDate = data.extent.minDate;
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
	const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

	// Widget layout (12-col grid, like stock/crm/finances): 6 KPI tiles across one
	// row, the two charts side-by-side, the posts list full-width.
	const items = $derived([
		...kpis.map((k) => ({ id: k.id, w: 2, h: 2 })),
		{ id: 'chart-spend', w: 6, h: 6 },
		{ id: 'chart-campaign', w: 6, h: 6 },
		{ id: 'posts', w: 12, h: 6 },
	]);

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

{#snippet cellBody(id: string)}
	{#if kpiById.has(id)}
		{@const k = kpiById.get(id)}
		{#if k}
			<div class="kpi">
				<div class="kpi-val">{k.value}</div>
				<div class="kpi-label">{k.label}</div>
				<div class="kpi-delta" class:pos={k.delta !== null && k.delta >= 0} class:neg={k.delta !== null && k.delta < 0}>
					{fmtDelta(k.delta)}
				</div>
			</div>
		{/if}
	{:else if id === 'chart-spend'}
		<div class="card">
			<div class="card-h">{m.ads_chart_spend_title()}</div>
			<Chart options={spendOpts} height="280px" />
		</div>
	{:else if id === 'chart-campaign'}
		<div class="card">
			<div class="card-h">{m.ads_chart_campaign_title()}</div>
			<Chart options={campaignOpts} height="280px" />
		</div>
	{:else if id === 'posts'}
		<div class="card">
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
{/snippet}

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
				{#if data.kpis && data.kpis.spend === 0 && data.kpis.impressions === 0}
					<p class="t-caption mb-2">{m.ads_dashboard_unsynced()}</p>
				{/if}
				<EditableGrid id="ads-dashboard-v1" {items} cols={12} rowHeight={56} canSetDefault={isAdmin.value} readonly={!canAct('ads', 'edit')}>
					{#snippet toolbar()}
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
							<button class="preset" onclick={presetAll}>{m.ads_preset_all()}</button>
						</div>
					{/snippet}
					{#snippet cell(id)}{@render cellBody(id)}{/snippet}
				</EditableGrid>
			{/if}
		</div>
	</div>
</div>

<style>
	.period-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.date-range {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.date-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
		white-space: nowrap;
	}
	.date-label input {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-card);
		color: var(--color-foreground);
		font-size: var(--font-size-body);
		color-scheme: dark;
	}
	.preset {
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-caption);
		background: transparent;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background var(--duration-fast), color var(--duration-fast);
	}
	.preset:hover {
		background: var(--color-card);
		color: inherit;
	}
	.kpi {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		height: 100%;
	}
	.kpi-val {
		font-size: var(--font-size-display);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
		margin-top: var(--space-1);
	}
	.kpi-delta {
		font-size: var(--font-size-caption);
		margin-top: var(--space-1);
		color: var(--color-muted-foreground);
	}
	.kpi-delta.pos {
		color: var(--color-success, var(--color-success-fg));
	}
	.kpi-delta.neg {
		color: var(--color-destructive, var(--color-danger-fg));
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: var(--space-3) var(--space-4);
		height: 100%;
		overflow: auto;
	}
	.card-h {
		font-size: var(--font-size-body);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		margin-bottom: var(--space-3);
	}
	.post-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.post-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--hairline);
	}
	.post-row:last-child {
		border-bottom: none;
	}
	.post-platform {
		flex-shrink: 0;
		font-size: var(--font-size-caption);
		padding: var(--space-0-5) var(--space-2);
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-platform[data-platform='ig'] {
		background: color-mix(in srgb, var(--color-pink, var(--color-pink)) 15%, transparent);
		color: var(--color-pink, var(--color-pink));
	}
	.post-platform[data-platform='fb'] {
		background: color-mix(in srgb, var(--color-info, var(--color-accent)) 15%, transparent);
		color: var(--color-info, var(--color-accent));
	}
	.post-caption {
		flex: 1;
		min-width: 0;
		font-size: var(--font-size-body);
	}
	.post-metrics {
		display: flex;
		gap: var(--space-2);
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
