<script lang="ts">
	import { goto } from '$lib/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { formatMoney, formatMoneyShort } from '$lib/utils/format';
	import { Megaphone, ExternalLink } from 'lucide-svelte';
	import { PageHeader, Button, EmptyState } from '$lib/components/ui';
	import Chart from '$lib/components/charts/Chart.svelte';
	import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
	import DateRangeControls from '$lib/components/dashboard/DateRangeControls.svelte';
	import { ALL_PERIODS, bucketKey, daysBetween, type Period } from '$lib/components/dashboard/date-range';
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
	// svelte-ignore state_referenced_locally
	let period = $state<Period>(data.period);

	function navigate(f: string, t: string, p: Period) {
		const q = new URLSearchParams();
		if (f) q.set('from', f);
		if (t) q.set('to', t);
		if (p !== 'day') q.set('period', p);
		goto(`/socials?${q}`, { keepFocus: true, noScroll: true });
	}

	// Bounds are INCLUSIVE, so the picker's `to` is used as-is (no +1 bump).
	function onRangeChange(v: { from: string; to: string; period: Period }) {
		fromDate = v.from;
		toDate = v.to;
		period = v.period;
		navigate(v.from, v.to, v.period);
	}

	// Ad spend carries the AD ACCOUNT's currency (PEN or USD), not the org default.
	const adCurrency = $derived(data.extent.currency ?? 'PEN');
	function fmtMoney(v: number): string {
		return formatMoney(v, adCurrency);
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}
	// Compact for big axis ticks, but keep cents when the scale is small — a CPC
	// axis rendered "S/ 0" five times in a row otherwise.
	function fmtAxisMoney(v: number): string {
		return Math.abs(v) >= 1000 ? formatMoneyShort(v, adCurrency) : formatMoney(v, adCurrency);
	}
	function fmtPct(v: number): string {
		return `${v.toFixed(2)}%`;
	}
	function fmtDelta(v: number | null): string {
		if (v === null) return '—';
		return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
	}

	// Conversations (Meta `actions[]` messaging conversions) are additive across
	// campaigns; cost-per-conversation is derived from the sums, never averaged.
	const convo = $derived({
		started: data.conversations,
		costPer: data.conversations > 0 && data.kpis ? data.kpis.spend / data.conversations : null,
	});

	const kpis = $derived(
		data.kpis
			? [
					{ id: 'spend', label: m.ads_kpi_spend(), value: fmtMoney(data.kpis.spend), delta: data.kpis.deltaPct.spend },
					{ id: 'conversations', label: m.ads_kpi_conversations(), value: fmtInt(convo.started), delta: null },
					{
						id: 'cost-per-convo',
						label: m.ads_kpi_cost_per_convo(),
						value: convo.costPer === null ? '—' : fmtMoney(convo.costPer),
						delta: null,
					},
					{ id: 'ctr', label: m.ads_kpi_ctr(), value: fmtPct(data.kpis.ctr), delta: data.kpis.deltaPct.ctr },
					{
						id: 'impressions',
						label: m.ads_kpi_impressions(),
						value: fmtInt(data.kpis.impressions),
						delta: data.kpis.deltaPct.impressions,
					},
					{ id: 'reach', label: m.ads_kpi_reach(), value: fmtInt(data.kpis.reach), delta: data.kpis.deltaPct.reach },
					{ id: 'clicks', label: m.ads_kpi_clicks(), value: fmtInt(data.kpis.clicks), delta: data.kpis.deltaPct.clicks },
					{ id: 'cpc', label: m.ads_kpi_cpc(), value: fmtMoney(data.kpis.cpc), delta: data.kpis.deltaPct.cpc },
				]
			: [],
	);
	const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

	// Widget layout (12-col grid): 8 KPI tiles (4 per row — wide enough that a
	// 7-figure amount never clips), the freshness strip, then the panels.
	const items = $derived([
		...kpis.map((k) => ({ id: k.id, w: 3, h: 2 })),
		{ id: 'freshness', w: 12, h: 2 },
		{ id: 'funnel', w: 4, h: 6 },
		{ id: 'chart-spend', w: 8, h: 6 },
		{ id: 'chart-efficiency', w: 6, h: 6 },
		{ id: 'chart-campaign', w: 6, h: 6 },
		{ id: 'campaign-table', w: 12, h: 6 },
		{ id: 'posts', w: 12, h: 6 },
	]);

	// ── Period bucketing ────────────────────────────────────────────────────────
	// The daily series is already loaded, so coarser granularities are a client
	// reduce — no extra query per period toggle.
	const series = $derived.by(() => {
		if (period === 'day') return data.series;
		const out = new Map<string, { date: string; spend: number; impressions: number; clicks: number }>();
		for (const r of data.series) {
			const key = bucketKey(r.date, period);
			const acc = out.get(key) ?? { date: key, spend: 0, impressions: 0, clicks: 0 };
			acc.spend += r.spend;
			acc.impressions += r.impressions;
			acc.clicks += r.clicks;
			out.set(key, acc);
		}
		return [...out.values()];
	});

	const spendOpts = $derived({
		grid: { left: 8, right: 18, top: 16, bottom: 30, containLabel: true },
		tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMoney(Number(v)) },
		xAxis: { type: 'category', data: series.map((r) => r.date), axisLabel: { hideOverlap: true } },
		yAxis: { type: 'value', axisLabel: { formatter: fmtAxisMoney, hideOverlap: true } },
		series: [
			{
				name: m.ads_kpi_spend(),
				type: 'line',
				areaStyle: { color: c.info, opacity: 0.25 },
				lineStyle: { color: c.info },
				itemStyle: { color: c.info },
				smooth: true,
				data: series.map((r) => Math.round(r.spend * 100) / 100),
			},
		],
	} satisfies EChartsOption);

	// Cost vs. attention: CPC (money, left) against CTR (%, right). Rising CPC with
	// falling CTR is the "creative is fatiguing" signal.
	const efficiencyOpts = $derived({
		grid: { left: 8, right: 8, top: 28, bottom: 30, containLabel: true },
		legend: { top: 0, textStyle: { color: c.mutedForeground } },
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', data: series.map((r) => r.date), axisLabel: { hideOverlap: true } },
		yAxis: [
			{
				type: 'value',
				axisLabel: { formatter: fmtAxisMoney, hideOverlap: true },
				splitLine: { lineStyle: { color: c.border } },
			},
			{ type: 'value', axisLabel: { formatter: (v: number) => `${v}%`, hideOverlap: true }, splitLine: { show: false } },
		],
		series: [
			{
				name: m.ads_kpi_cpc(),
				type: 'line',
				smooth: true,
				lineStyle: { color: c.purple },
				itemStyle: { color: c.purple },
				tooltip: { valueFormatter: (v) => fmtMoney(Number(v)) },
				data: series.map((r) => (r.clicks > 0 ? Math.round((r.spend / r.clicks) * 100) / 100 : 0)),
			},
			{
				name: m.ads_kpi_ctr(),
				type: 'line',
				yAxisIndex: 1,
				smooth: true,
				lineStyle: { color: c.cyan },
				itemStyle: { color: c.cyan },
				tooltip: { valueFormatter: (v) => `${Number(v).toFixed(2)}%` },
				data: series.map((r) => (r.impressions > 0 ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0)),
			},
		],
	} satisfies EChartsOption);

	const topCampaigns = $derived(data.campaigns); // top spenders, sorted server-side

	const campaignOpts = $derived({
		grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
		tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMoney(Number(v)) },
		yAxis: { type: 'category', data: topCampaigns.map((r) => r.campaignName ?? r.campaignId ?? '—'), inverse: true },
		// hideOverlap: a money-formatted value axis in a half-width card runs its
		// ticks into each other otherwise ("S/ 10 KS/ 20 K").
		xAxis: {
			type: 'value',
			axisLabel: { formatter: fmtAxisMoney, hideOverlap: true },
		},
		series: [{ type: 'bar', itemStyle: { color: c.accent }, data: topCampaigns.map((r) => Math.round(r.spend * 100) / 100) }],
	} satisfies EChartsOption);

	// ── Funnel: each step's bar is its retention off the PREVIOUS step, so the
	// steps stay comparable instead of impressions dwarfing everything. ─────────
	const funnel = $derived.by(() => {
		const k = data.kpis;
		if (!k) return [];
		const steps = [
			{ id: 'impressions', label: m.ads_kpi_impressions(), value: k.impressions, prev: k.impressions },
			{ id: 'reach', label: m.ads_kpi_reach(), value: k.reach, prev: k.impressions },
			{ id: 'clicks', label: m.ads_kpi_clicks(), value: k.clicks, prev: k.reach },
			{ id: 'conversations', label: m.ads_kpi_conversations(), value: convo.started, prev: k.clicks },
		];
		return steps.map((s) => {
			const rate = s.prev > 0 ? (s.value / s.prev) * 100 : 0;
			return { ...s, rate, pct: Math.max(0, Math.min(100, rate)) };
		});
	});

	const daysInView = $derived(fromDate && toDate ? daysBetween(fromDate, toDate) + 1 : 0);
	const lastSyncLabel = $derived(
		data.lastSync?.finishedAt ? new Date(data.lastSync.finishedAt).toLocaleString() : m.ads_freshness_never(),
	);

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
				<div class="kpi-val" title={k.value}>{k.value}</div>
				<div class="kpi-label">{k.label}</div>
				<div class="kpi-delta" class:pos={k.delta !== null && k.delta >= 0} class:neg={k.delta !== null && k.delta < 0}>
					{fmtDelta(k.delta)}
				</div>
			</div>
		{/if}
	{:else if id === 'freshness'}
		<div class="card fresh">
			<div class="fresh-stat">
				<span class="fresh-label">{m.ads_freshness_through()}</span>
				<span class="fresh-val">{data.extent.maxDate ?? '—'}</span>
			</div>
			<div class="fresh-stat">
				<span class="fresh-label">{m.ads_freshness_last_sync()}</span>
				<span class="fresh-val">{lastSyncLabel}</span>
			</div>
			<div class="fresh-stat">
				<span class="fresh-label">{m.ads_freshness_days_in_view()}</span>
				<span class="fresh-val">{fmtInt(daysInView)}</span>
			</div>
		</div>
	{:else if id === 'funnel'}
		<div class="card">
			<div class="card-h">{m.ads_funnel_title()}</div>
			<div class="funnel">
				{#each funnel as s (s.id)}
					<div class="frow">
						<span class="flabel">{s.label}</span>
						<span class="fval">{fmtInt(s.value)}</span>
						<span class="frate" title={m.ads_funnel_vs_prev()}>{fmtPct(s.rate)}</span>
						<span class="fbar"><span class="fbar-fill" style:width={`${s.pct}%`}></span></span>
					</div>
				{/each}
			</div>
			<p class="t-caption fnote">{m.ads_funnel_vs_prev()}</p>
		</div>
	{:else if id === 'chart-spend'}
		<div class="card">
			<div class="card-h">{m.ads_chart_spend_title()}</div>
			<Chart options={spendOpts} height="280px" />
		</div>
	{:else if id === 'chart-efficiency'}
		<div class="card">
			<div class="card-h">{m.ads_chart_efficiency_title()}</div>
			<Chart options={efficiencyOpts} height="280px" />
		</div>
	{:else if id === 'chart-campaign'}
		<div class="card">
			<div class="card-h">{m.ads_chart_campaign_title()}</div>
			<Chart options={campaignOpts} height="280px" />
		</div>
	{:else if id === 'campaign-table'}
		<div class="card">
			<div class="card-h">{m.ads_campaign_table_title()}</div>
			{#if topCampaigns.length === 0}
				<p class="t-caption">{m.ads_table_no_campaigns()}</p>
			{:else}
				<table class="mini-table">
					<thead>
						<tr>
							<th>{m.ads_col_campaign()}</th>
							<th class="num">{m.ads_col_spend()}</th>
							<th class="num">{m.ads_col_conversations()}</th>
							<th class="num">{m.ads_col_cost_per_convo()}</th>
							<th class="num">{m.ads_col_ctr()}</th>
							<th class="num">{m.ads_col_clicks()}</th>
						</tr>
					</thead>
					<tbody>
						{#each topCampaigns as r (r.campaignId ?? r.campaignName)}
							<tr>
								<td class="cname">
									{#if r.campaignId}
										<a href="/socials/campaigns/{encodeURIComponent(r.campaignId)}">{r.campaignName ?? r.campaignId}</a>
									{:else}
										{r.campaignName ?? '—'}
									{/if}
								</td>
								<td class="num">{fmtMoney(r.spend)}</td>
								<td class="num">{fmtInt(r.conversationsStarted)}</td>
								<td class="num">{r.costPerConversation === null ? '—' : fmtMoney(r.costPerConversation)}</td>
								<td class="num">{fmtPct(r.ctr)}</td>
								<td class="num">{fmtInt(r.clicks)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
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
							{#if post.thumbFileId}
								<img src="/api/files/{post.thumbFileId}/raw" loading="lazy" alt="" width="36" height="36" class="post-thumb" />
							{/if}
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

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
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
							<DateRangeControls
								from={fromDate}
								to={toDate}
								{period}
								periods={ALL_PERIODS}
								dataMin={data.extent.minDate ?? ''}
								dataMax={data.extent.maxDate ?? ''}
								storageKey="socials"
								onChange={onRangeChange}
							/>
					{/snippet}
					{#snippet cell(id)}{@render cellBody(id)}{/snippet}
				</EditableGrid>
			{/if}
		</div>
	</div>
</div>

<style>
	.kpi {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		height: 100%;
		/* Value type scales with the tile, so a 7-figure amount can't bleed past
		   the card edge when the grid narrows. */
		container-type: inline-size;
		--kpi-val-size: min(var(--font-size-display), 11cqi);
	}
	.kpi-val {
		font-size: var(--kpi-val-size);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	/* Freshness strip — qualifies every other number on the page. */
	.fresh {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-8);
	}
	.fresh-stat {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.fresh-label {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
	}
	.fresh-val {
		font-size: var(--font-size-body);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	/* Bar-row contract: the CONTAINER owns the tracks, rows are subgrid, so every
	   bar starts at the same x. */
	.funnel {
		display: grid;
		grid-template-columns: max-content max-content max-content 1fr;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.frow {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		align-items: center;
	}
	.flabel {
		font-size: var(--font-size-body);
		color: var(--color-text-secondary);
	}
	.fval {
		font-size: var(--font-size-body);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.frate {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.fbar {
		height: 0.5rem;
		min-width: 2rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		overflow: hidden;
	}
	.fbar-fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-full);
		background: var(--color-accent);
	}
	.fnote {
		margin-top: var(--space-3);
		color: var(--color-muted-foreground);
	}
	.mini-table {
		width: 100%;
		font-size: var(--font-size-body);
		border-collapse: collapse;
	}
	.mini-table th {
		text-align: left;
		font-weight: 500;
		color: var(--color-muted-foreground);
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--hairline);
		white-space: nowrap;
	}
	.mini-table td {
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--hairline);
	}
	.mini-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cname {
		max-width: 22rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cname a:hover {
		color: var(--color-accent);
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
	.post-thumb {
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		object-fit: cover;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
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
		background: color-mix(in srgb, var(--color-pink) 15%, transparent);
		color: var(--color-pink);
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
