<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Wallet } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	import Chart from '$lib/components/charts/Chart.svelte';
	import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
	import { isAdmin } from '$lib/state/features/user.svelte';
	import { canAct } from '$lib/access/can.svelte';
	import { chartColors } from '$lib/utils/chart-colors';
	import { locale } from '$lib/state/ui/locale.svelte';
	import type { EChartsOption } from 'echarts';

	let { data }: { data: PageData } = $props();

	// Theme-resolved colors (ECharts can't read CSS var() in series colors).
	const c = $derived(chartColors());

	// Localized bucket label: month → "MMM yyyy", day/week → "dd MMM yyyy".
	// The day-first pattern is fixed by request; only the month NAME is localized
	// (toLocaleDateString would otherwise reorder parts per locale, e.g. en → "May 20").
	// Bucket values are UTC YYYY-MM-DD; read in UTC so the day doesn't shift.
	function fmtBucket(iso: string): string {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return iso;
		const mon = d.toLocaleDateString(locale.current, { month: 'short', timeZone: 'UTC' });
		const year = d.getUTCFullYear();
		if (bucket === 'month') return `${mon} ${year}`;
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${day} ${mon} ${year}`;
	}

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

	// Compact money for crowded value axes (e.g. horizontal bar charts) so labels
	// like "S/ 10,000" don't overlap. Tooltips still use the full formatMoney.
	function moneyShort(val: number): string {
		const cur = !data.summary.currency || data.summary.currency === 'PEN' ? 'S/' : data.summary.currency;
		const a = Math.abs(val);
		if (a >= 1_000_000) return `${cur} ${(val / 1_000_000).toFixed(a % 1_000_000 ? 1 : 0)}M`;
		if (a >= 1_000) return `${cur} ${Math.round(val / 1000)}k`;
		return `${cur} ${Math.round(val)}`;
	}

	const periodGrowth = $derived((() => {
		const s = data.series;
		if (s.length < 2) return null;
		const curr = s[s.length - 1].revenue;
		const prev = s[s.length - 2].revenue;
		return prev > 0 ? ((curr - prev) / prev) * 100 : null;
	})());

	const revenueOpts = $derived((() => {
		const xData = data.series.map((r) => fmtBucket(r.bucket));
		// Stacked: net revenue (bottom) → discount → void. Cumulative running-totals
		// each band independently so the stack still reads as a composition.
		const pick = (sel: (r: (typeof data.series)[number]) => number) => {
			if (mode !== 'cumulative') return data.series.map(sel);
			let sum = 0;
			return data.series.map((r) => (sum += sel(r)));
		};
		const netData = pick((r) => r.revenue);
		const discountData = pick((r) => r.discount);
		const voidData = pick((r) => r.voided);
		const area = (color: string) => ({
			name: '',
			type: 'line' as const,
			stack: 'total',
			areaStyle: { color, opacity: 0.85 },
			lineStyle: { width: 1 },
			itemStyle: { color },
			symbol: 'circle',
			symbolSize: 4,
			smooth: true
		});
		return {
			grid: { left: 8, right: 18, top: 16, bottom: 30, containLabel: true },
			tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
			legend: { data: [m.fin_chart_net_revenue(), m.fin_chart_discount(), m.fin_chart_void()], bottom: 0 },
			xAxis: { type: 'category', data: xData, axisLabel: { hideOverlap: true } },
			yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v) } },
			series: [
				{ ...area(c.info), name: m.fin_chart_net_revenue(), data: netData },
				{ ...area(c.success), name: m.fin_chart_discount(), data: discountData },
				{ ...area(c.destructive), name: m.fin_chart_void(), data: voidData }
			]
		} satisfies EChartsOption;
	})());

	const avgTicketOpts = $derived({
		grid: { left: 8, right: 18, top: 16, bottom: 24, containLabel: true },
		tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
		xAxis: { type: 'category', data: data.series.map((r) => fmtBucket(r.bucket)), axisLabel: { hideOverlap: true } },
		yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v) } },
		series: [
			{
				name: m.fin_chart_avg_ticket(),
				type: 'line',
				data: data.series.map((r) => (r.invoices > 0 ? Math.round(r.revenue / r.invoices) : 0)),
				smooth: true
			}
		]
	} satisfies EChartsOption);

	const topProductsOpts = $derived((() => {
		const sorted = [...data.products]
			.sort((a, b) => (prodMode === 'revenue' ? b.revenue - a.revenue : b.qty - a.qty))
			.slice(0, 12);
		const fmt = (v: number) => (prodMode === 'revenue' ? formatMoney(v) : Math.round(v).toLocaleString());
		const fmtAxis = (v: number) => (prodMode === 'revenue' ? moneyShort(v) : Math.round(v).toLocaleString());
		return {
			grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
			tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(Number(v)) },
			// Items on Y, amount on X (horizontal bars), highest at top.
			yAxis: { type: 'category', data: sorted.map((p) => p.name ?? p.code ?? '—'), inverse: true },
			xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtAxis(v), hideOverlap: true } },
			series: [
				{
					type: 'bar',
					data: sorted.map((p) => (prodMode === 'revenue' ? Math.round(p.revenue) : p.qty))
				}
			]
		} satisfies EChartsOption;
	})());

	const topClientsOpts = $derived((() => {
		const sorted = [...data.clients].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
		return {
			grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
			tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
			yAxis: { type: 'category', data: sorted.map((c) => c.name ?? c.docNumber ?? '—'), inverse: true },
			xAxis: { type: 'value', axisLabel: { formatter: (v: number) => moneyShort(v), hideOverlap: true } },
			series: [{ type: 'bar', data: sorted.map((c) => Math.round(c.revenue)) }]
		} satisfies EChartsOption;
	})());

	const buckets: Array<{ key: 'day' | 'week' | 'month'; label: () => string }> = [
		{ key: 'day', label: m.fin_bucket_day },
		{ key: 'week', label: m.fin_bucket_week },
		{ key: 'month', label: m.fin_bucket_month }
	];

	// KPI cards rendered by the editable grid (id-keyed).
	const kpis = $derived([
		{ id: 'k-net', label: m.fin_kpi_net_revenue(), value: formatMoney(data.summary.totalNet) },
		{ id: 'k-avg', label: m.fin_kpi_avg_ticket(), value: formatMoney(data.summary.avgTicket) },
		{ id: 'k-invoices', label: m.fin_kpi_invoices(), value: data.summary.invoiceCount.toLocaleString() },
		{ id: 'k-clients', label: m.fin_kpi_unique_clients(), value: data.summary.uniqueClients.toLocaleString() },
		{ id: 'k-newclients', label: m.fin_kpi_new_clients(), value: data.summary.newClients.toLocaleString() },
		{ id: 'k-discount', label: m.fin_kpi_discount_rate(), value: `${(data.summary.discountRate * 100).toFixed(1)}%`, href: '/finances/invoices?discounted=1' },
		{
			id: 'k-growth',
			label: m.fin_kpi_growth(),
			value: periodGrowth !== null ? `${periodGrowth >= 0 ? '+' : ''}${periodGrowth.toFixed(1)}%` : '—',
		},
		{ id: 'k-void', label: m.fin_kpi_void_rate(), value: `${(data.summary.voidRate * 100).toFixed(1)}%`, href: '/finances/invoices?status=void' },
	]);
	const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

	// Grid items: 8 KPIs (3×2) then the four charts. Order/spans are user-editable
	// and persisted (localStorage personal + org default). Chart heights are sized
	// to roughly match their default span so the plot fills the cell.
	// ponytail: fixed chart px-heights; vertical resize sets the floor, not the chart
	// height (EditableGrid rows are minmax(row, auto) — no definite height to fill).
	const items = $derived([
		...kpis.map((k) => ({ id: k.id, w: 3, h: 2 })),
		{ id: 'revenue', w: 12, h: 6 },
		{ id: 'avgticket', w: 12, h: 5 },
		{ id: 'products', w: 6, h: 6 },
		{ id: 'clients', w: 6, h: 6 },
	]);
</script>

<svelte:head><title>{m.nav_finance()}</title></svelte:head>

<!-- Period controls — shared between the empty state and the grid toolbar. -->
{#snippet periodControls()}
	<div class="period-controls">
		<div class="date-range">
			<label class="date-label">
				<span>{m.fin_date_from()}</span>
				<input type="date" bind:value={fromDate} oninput={() => navigate(fromDate, toDate, bucket)} />
			</label>
			<label class="date-label">
				<span>{m.fin_date_to()}</span>
				<input type="date" bind:value={toDate} oninput={() => navigate(fromDate, toDate, bucket)} />
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
{/snippet}

<!-- One snippet keyed by item id — EditableGrid renders each cell by id. -->
{#snippet cellBody(id: string)}
	{#if id.startsWith('k-')}
		{@const k = kpiById.get(id)}
		{#if k}
			{@const href = 'href' in k ? k.href : undefined}
			{#if href}
				<a class="kpi kpi-link" {href}>
					<div class="kpi-val">{k.value}</div>
					<div class="kpi-label">{k.label}</div>
				</a>
			{:else}
				<div class="kpi">
					<div class="kpi-val">{k.value}</div>
					<div class="kpi-label">{k.label}</div>
				</div>
			{/if}
		{/if}
	{:else if id === 'revenue'}
		<div class="card">
			<div class="card-h-row">
				<span class="card-h">{m.fin_chart_revenue_area()}</span>
				<div class="chart-toggle">
					<button class:active={mode === 'period'} onclick={() => (mode = 'period')}>{m.fin_toggle_period()}</button>
					<button class:active={mode === 'cumulative'} onclick={() => (mode = 'cumulative')}>{m.fin_toggle_cumulative()}</button>
				</div>
			</div>
			<Chart options={revenueOpts} height="330px" />
		</div>
	{:else if id === 'avgticket'}
		<div class="card">
			<div class="card-h">{m.fin_chart_avg_ticket()}</div>
			<Chart options={avgTicketOpts} height="270px" />
		</div>
	{:else if id === 'products'}
		<div class="card">
			<div class="card-h-row">
				<span class="card-h">{m.fin_chart_top_products()}</span>
				<div class="chart-toggle">
					<button class:active={prodMode === 'revenue'} onclick={() => (prodMode = 'revenue')}>{m.fin_toggle_revenue()}</button>
					<button class:active={prodMode === 'qty'} onclick={() => (prodMode = 'qty')}>{m.fin_toggle_qty()}</button>
				</div>
			</div>
			<Chart options={topProductsOpts} height="330px" />
		</div>
	{:else if id === 'clients'}
		<div class="card">
			<div class="card-h">{m.fin_chart_top_clients()}</div>
			<Chart options={topClientsOpts} height="330px" />
		</div>
	{/if}
{/snippet}

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_finance()} subtitle={m.fin_dashboard_subtitle()}>
		{#snippet leading()}<Wallet size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<!-- Full-width scroller so the scrollbar hugs the screen edge; content padded. -->
	<div class="flex-1 min-h-0 overflow-auto p-4">
		<div class="w-full max-w-6xl mx-auto">
			{#if !data.hasData}
				{@render periodControls()}
				<p class="t-caption mt-4">{m.fin_empty()}</p>
			{:else}
				<EditableGrid id="finances-dashboard-v1" {items} cols={12} rowHeight={56} canSetDefault={isAdmin.value} readonly={!canAct('finance', 'edit')}>
					{#snippet toolbar()}{@render periodControls()}{/snippet}
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
		/* Render the native calendar picker icon + popup in dark mode so the
		   indicator contrasts against the dark input (hub convention). */
		color-scheme: dark;
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
	.kpi {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0.85rem 1rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		height: 100%;
	}
	.kpi-link {
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s, background 0.12s;
		cursor: pointer;
	}
	.kpi-link:hover {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 6%, var(--color-card));
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
</style>
