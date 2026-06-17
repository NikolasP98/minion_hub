<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Wallet } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let fromDate = $state(data.period.from ? data.period.from.slice(0, 10) : '');
	// svelte-ignore state_referenced_locally
	let toDate = $state(data.period.to ? data.period.to.slice(0, 10) : '');
	// svelte-ignore state_referenced_locally
	let bucket = $state(data.period.bucket);

	let mode = $state<'period' | 'cumulative'>('period');
	let prodMode = $state<'revenue' | 'qty'>('revenue');

	function navigate(f: string, t: string, b: string) {
		const p = new URLSearchParams();
		if (f) p.set('from', f);
		if (t) p.set('to', t);
		p.set('bucket', b);
		goto(`/finances?${p}`, { keepFocus: true, noScroll: true });
	}

	function preset30d() {
		const to = new Date();
		const from = new Date();
		from.setDate(from.getDate() - 30);
		const f = from.toISOString().slice(0, 10);
		const t = to.toISOString().slice(0, 10);
		fromDate = f;
		toDate = t;
		navigate(f, t, 'day');
	}

	function preset12m() {
		const to = new Date();
		const from = new Date();
		from.setMonth(from.getMonth() - 12);
		const f = from.toISOString().slice(0, 10);
		const t = to.toISOString().slice(0, 10);
		fromDate = f;
		toDate = t;
		navigate(f, t, 'month');
	}

	function presetYTD() {
		const now = new Date();
		const f = `${now.getFullYear()}-01-01`;
		const t = now.toISOString().slice(0, 10);
		fromDate = f;
		toDate = t;
		navigate(f, t, 'month');
	}

	function presetAll() {
		fromDate = '';
		toDate = '';
		navigate('', '', 'month');
	}

	function formatMoney(val: number): string {
		try {
			return val.toLocaleString('es-PE', {
				style: 'currency',
				currency: data.summary.currency || 'PEN',
				maximumFractionDigits: 0
			});
		} catch {
			return `${data.summary.currency || 'S/'} ${Math.round(val).toLocaleString()}`;
		}
	}

	const periodGrowth = $derived((() => {
		const s = data.series;
		if (s.length < 2) return null;
		const half = Math.floor(s.length / 2);
		const prev = s.slice(0, half).reduce((a, r) => a + r.revenue, 0);
		const curr = s.slice(half).reduce((a, r) => a + r.revenue, 0);
		return prev > 0 ? ((curr - prev) / prev) * 100 : null;
	})());

	const revenueOpts = $derived((() => {
		const xData = data.series.map((r) => r.bucket);
		let netData: number[];
		let discountData: number[];
		if (mode === 'cumulative') {
			let netSum = 0;
			let discSum = 0;
			netData = data.series.map((r) => (netSum += r.revenue));
			discountData = data.series.map((r) => (discSum += r.discount));
		} else {
			netData = data.series.map((r) => r.revenue);
			discountData = data.series.map((r) => r.discount);
		}
		return {
			tooltip: { trigger: 'axis' },
			legend: { data: [m.fin_chart_net_revenue(), m.fin_chart_discount()] },
			xAxis: { type: 'category', data: xData },
			yAxis: { type: 'value' },
			series: [
				{ name: m.fin_chart_net_revenue(), type: 'line', areaStyle: {}, data: netData, smooth: true },
				{ name: m.fin_chart_discount(), type: 'line', areaStyle: {}, data: discountData, smooth: true }
			]
		} satisfies EChartsOption;
	})());

	const avgTicketOpts = $derived({
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', data: data.series.map((r) => r.bucket) },
		yAxis: { type: 'value' },
		series: [
			{
				name: m.fin_chart_avg_ticket(),
				type: 'line',
				data: data.series.map((r) => (r.invoices > 0 ? +(r.revenue / r.invoices).toFixed(2) : 0)),
				smooth: true
			}
		]
	} satisfies EChartsOption);

	const topProductsOpts = $derived((() => {
		const sorted = [...data.products].sort((a, b) =>
			prodMode === 'revenue' ? b.revenue - a.revenue : b.qty - a.qty
		);
		return {
			tooltip: { trigger: 'axis' },
			xAxis: {
				type: 'category',
				data: sorted.map((p) => p.name ?? p.code ?? '—'),
				axisLabel: { rotate: 30 }
			},
			yAxis: { type: 'value' },
			series: [
				{
					type: 'bar',
					data: sorted.map((p) => (prodMode === 'revenue' ? p.revenue : p.qty))
				}
			]
		} satisfies EChartsOption;
	})());

	const topClientsOpts = $derived((() => {
		const sorted = [...data.clients].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
		return {
			tooltip: { trigger: 'axis' },
			yAxis: { type: 'category', data: sorted.map((c) => c.name ?? c.docNumber ?? '—') },
			xAxis: { type: 'value' },
			series: [{ type: 'bar', data: sorted.map((c) => c.revenue) }]
		} satisfies EChartsOption;
	})());

	const buckets: Array<{ key: 'day' | 'week' | 'month'; label: () => string }> = [
		{ key: 'day', label: m.fin_bucket_day },
		{ key: 'week', label: m.fin_bucket_week },
		{ key: 'month', label: m.fin_bucket_month }
	];
</script>

<svelte:head><title>{m.nav_finance()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_finance()} subtitle={m.fin_dashboard_subtitle()}>
		{#snippet leading()}<Wallet size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-6xl">
		<!-- Period controls -->
		<div class="period-controls">
			<div class="date-range">
				<label class="date-label">
					<span>{m.fin_date_from()}</span>
					<input
						type="date"
						bind:value={fromDate}
						oninput={() => navigate(fromDate, toDate, bucket)}
					/>
				</label>
				<label class="date-label">
					<span>{m.fin_date_to()}</span>
					<input
						type="date"
						bind:value={toDate}
						oninput={() => navigate(fromDate, toDate, bucket)}
					/>
				</label>
			</div>
			<div class="seg-group">
				{#each buckets as b (b.key)}
					<button
						class="seg"
						class:active={bucket === b.key}
						onclick={() => {
							bucket = b.key;
							navigate(fromDate, toDate, b.key);
						}}
					>{b.label()}</button>
				{/each}
			</div>
			<div class="presets">
				<button class="preset" onclick={preset30d}>{m.fin_preset_30d()}</button>
				<button class="preset" onclick={preset12m}>{m.fin_preset_12m()}</button>
				<button class="preset" onclick={presetYTD}>{m.fin_preset_ytd()}</button>
				<button class="preset" onclick={presetAll}>{m.fin_preset_all()}</button>
			</div>
		</div>

		{#if !data.hasData}
			<p class="t-caption">{m.fin_empty()}</p>
		{:else}
			<!-- KPI row -->
			<div class="kpi-row">
				<div class="kpi">
					<div class="kpi-val">{formatMoney(data.summary.totalNet)}</div>
					<div class="kpi-label">{m.fin_kpi_net_revenue()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{formatMoney(data.summary.avgTicket)}</div>
					<div class="kpi-label">{m.fin_kpi_avg_ticket()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{data.summary.invoiceCount.toLocaleString()}</div>
					<div class="kpi-label">{m.fin_kpi_invoices()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{data.summary.uniqueClients.toLocaleString()}</div>
					<div class="kpi-label">{m.fin_kpi_unique_clients()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{data.summary.newClients.toLocaleString()}</div>
					<div class="kpi-label">{m.fin_kpi_new_clients()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{data.summary.discountRate.toFixed(1)}%</div>
					<div class="kpi-label">{m.fin_kpi_discount_rate()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">
						{periodGrowth !== null ? `${periodGrowth >= 0 ? '+' : ''}${periodGrowth.toFixed(1)}%` : '—'}
					</div>
					<div class="kpi-label">{m.fin_kpi_growth()}</div>
				</div>
				<div class="kpi">
					<div class="kpi-val">{data.summary.voidRate.toFixed(1)}%</div>
					<div class="kpi-label">{m.fin_kpi_void_rate()}</div>
				</div>
			</div>

			<!-- Revenue area chart -->
			<div class="card">
				<div class="card-h-row">
					<span class="card-h">{m.fin_chart_revenue_area()}</span>
					<div class="chart-toggle">
						<button
							class:active={mode === 'period'}
							onclick={() => (mode = 'period')}
						>{m.fin_toggle_period()}</button>
						<button
							class:active={mode === 'cumulative'}
							onclick={() => (mode = 'cumulative')}
						>{m.fin_toggle_cumulative()}</button>
					</div>
				</div>
				<Chart options={revenueOpts} height="280px" />
			</div>

			<!-- Avg ticket chart -->
			<div class="card">
				<div class="card-h">{m.fin_chart_avg_ticket()}</div>
				<Chart options={avgTicketOpts} height="220px" />
			</div>

			<!-- Top products + Top clients -->
			<div class="charts-row">
				<div class="card">
					<div class="card-h-row">
						<span class="card-h">{m.fin_chart_top_products()}</span>
						<div class="chart-toggle">
							<button
								class:active={prodMode === 'revenue'}
								onclick={() => (prodMode = 'revenue')}
							>{m.fin_toggle_revenue()}</button>
							<button
								class:active={prodMode === 'qty'}
								onclick={() => (prodMode = 'qty')}
							>{m.fin_toggle_qty()}</button>
						</div>
					</div>
					<Chart options={topProductsOpts} height="260px" />
				</div>
				<div class="card">
					<div class="card-h">{m.fin_chart_top_clients()}</div>
					<Chart options={topClientsOpts} height="260px" />
				</div>
			</div>
		{/if}
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
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
	}
	.date-label input {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--color-card);
		color: inherit;
		font-size: 0.82rem;
	}
	.seg-group {
		display: flex;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		overflow: hidden;
	}
	.seg {
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background 0.15s, color 0.15s;
	}
	.seg:not(:last-child) {
		border-right: 1px solid var(--hairline);
	}
	.seg.active {
		background: var(--color-accent);
		color: #fff;
	}
	.presets {
		display: flex;
		gap: 0.35rem;
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
	.kpi-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.kpi {
		padding: 0.85rem 1rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		min-width: 9rem;
	}
	.kpi-val {
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		margin-top: 0.15rem;
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
		display: block;
	}
	.card-h-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.8rem;
	}
	.card-h-row .card-h {
		margin-bottom: 0;
	}
	.chart-toggle {
		display: flex;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		overflow: hidden;
	}
	.chart-toggle button {
		padding: 0.2rem 0.6rem;
		font-size: 0.72rem;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background 0.15s, color 0.15s;
	}
	.chart-toggle button:not(:last-child) {
		border-right: 1px solid var(--hairline);
	}
	.chart-toggle button.active {
		background: var(--color-accent);
		color: #fff;
	}
	.charts-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 700px) {
		.charts-row {
			grid-template-columns: 1fr;
		}
	}
</style>
