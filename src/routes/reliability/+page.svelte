<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import KpiCard from '$lib/components/reliability/KpiCard.svelte';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import IncidentTable from '$lib/components/reliability/IncidentTable.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents
	} from '$lib/state/reliability.svelte';
	import { hostsState } from '$lib/state/hosts.svelte';
	import { onMount, untrack } from 'svelte';
	import type { EChartsOption } from 'echarts';

	const CATEGORY_COLORS: Record<string, string> = {
		cron: '#3b82f6',
		browser: '#f59e0b',
		timezone: '#a855f7',
		general: '#64748b'
	};

	const SEVERITY_COLORS: Record<string, string> = {
		critical: '#ef4444',
		high: '#f59e0b',
		medium: '#a855f7',
		low: '#64748b'
	};

	const CATEGORIES = ['cron', 'browser', 'timezone', 'general'] as const;

	let summary = $derived(reliability.summary);
	let loading = $derived(reliability.loading);
	let serverId = $derived(hostsState.activeHostId);

	async function loadData() {
		if (!serverId) return;
		const { from, to } = reliability.dateRange;
		await Promise.all([
			loadReliabilitySummary(serverId, from, to),
			loadReliabilityEvents(serverId, { from, to, limit: 200 })
		]);
	}

	function handleDateChange(from: number, to: number) {
		reliability.dateRange.from = from;
		reliability.dateRange.to = to;
	}

	onMount(() => {
		if (serverId) {
			loadData();
		}
	});

	// Reload when dateRange changes
	$effect(() => {
		// Track these reactive values
		const _from = reliability.dateRange.from;
		const _to = reliability.dateRange.to;
		const _sid = serverId;
		if (_sid) {
			untrack(() => loadData());
		}
	});

	// ── Timeline chart options ───────────────────────────────────────────────
	let timelineOptions: EChartsOption = $derived.by(() => {
		const ts = summary?.timeseries ?? [];
		if (ts.length === 0) {
			return {
				title: {
					text: 'Events over Time',
					left: 16,
					top: 8,
					textStyle: { fontSize: 13, fontWeight: 600 }
				},
				grid: { left: 48, right: 24, top: 48, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value' },
				series: []
			};
		}

		// Collect unique sorted bucket timestamps
		const bucketSet = new Set<number>();
		for (const point of ts) {
			bucketSet.add(point.bucket);
		}
		const buckets = [...bucketSet].sort((a, b) => a - b);

		// Build a lookup: bucket -> category -> count
		const lookup = new Map<number, Map<string, number>>();
		for (const point of ts) {
			if (!lookup.has(point.bucket)) {
				lookup.set(point.bucket, new Map());
			}
			lookup.get(point.bucket)!.set(point.category, point.count);
		}

		const series = CATEGORIES.map((cat) => ({
			name: cat,
			type: 'line' as const,
			stack: 'events',
			smooth: true,
			symbol: 'none',
			lineStyle: { width: 1.5, color: CATEGORY_COLORS[cat] },
			itemStyle: { color: CATEGORY_COLORS[cat] },
			areaStyle: { opacity: 0.3, color: CATEGORY_COLORS[cat] },
			data: buckets.map((b) => [b, lookup.get(b)?.get(cat) ?? 0])
		}));

		return {
			title: {
				text: 'Events over Time',
				left: 16,
				top: 8,
				textStyle: { fontSize: 13, fontWeight: 600 }
			},
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'cross' }
			},
			legend: {
				data: [...CATEGORIES],
				top: 8,
				right: 16,
				textStyle: { fontSize: 11 }
			},
			grid: { left: 48, right: 24, top: 48, bottom: 32 },
			xAxis: {
				type: 'time',
				axisLabel: {
					fontSize: 10,
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
					}
				}
			},
			yAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10 }
			},
			series
		};
	});

	// ── Top Events bar chart options ─────────────────────────────────────────
	let topEventsOptions: EChartsOption = $derived.by(() => {
		const topEvents = summary?.topEvents ?? [];
		if (topEvents.length === 0) {
			return {
				title: {
					text: 'Top Events',
					left: 16,
					top: 8,
					textStyle: { fontSize: 13, fontWeight: 600 }
				},
				grid: { left: 48, right: 24, top: 48, bottom: 24 },
				xAxis: { type: 'value' },
				yAxis: { type: 'category', data: [] },
				series: []
			};
		}

		// Reverse so highest count is at top in horizontal bar
		const reversed = [...topEvents].reverse();

		return {
			title: {
				text: 'Top Events',
				left: 16,
				top: 8,
				textStyle: { fontSize: 13, fontWeight: 600 }
			},
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' }
			},
			grid: { left: 120, right: 24, top: 48, bottom: 24 },
			xAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10 }
			},
			yAxis: {
				type: 'category',
				data: reversed.map((e) => e.event),
				axisLabel: {
					fontSize: 10,
					width: 100,
					overflow: 'truncate'
				}
			},
			series: [
				{
					type: 'bar',
					data: reversed.map((e) => e.count),
					itemStyle: {
						color: '#3b82f6',
						borderRadius: [0, 4, 4, 0]
					},
					barMaxWidth: 24
				}
			]
		};
	});

	// ── Severity pie chart options ───────────────────────────────────────────
	let severityOptions: EChartsOption = $derived.by(() => {
		const bySeverity = summary?.bySeverity ?? {};
		const total = summary?.total ?? 0;
		const data = Object.entries(bySeverity)
			.filter(([, count]) => count > 0)
			.map(([name, value]) => ({
				name,
				value,
				itemStyle: { color: SEVERITY_COLORS[name] ?? '#64748b' }
			}));

		return {
			title: {
				text: 'Severity Distribution',
				left: 16,
				top: 8,
				textStyle: { fontSize: 13, fontWeight: 600 }
			},
			tooltip: {
				trigger: 'item',
				formatter: '{b}: {c} ({d}%)'
			},
			series: [
				{
					type: 'pie',
					radius: ['45%', '70%'],
					center: ['50%', '55%'],
					avoidLabelOverlap: true,
					label: {
						show: true,
						fontSize: 11,
						color: '#94a3b8'
					},
					emphasis: {
						label: { show: true, fontWeight: 'bold' }
					},
					data,
					itemStyle: {
						borderColor: '#151d2e',
						borderWidth: 2
					}
				}
			],
			graphic: [
				{
					type: 'text',
					left: 'center',
					top: '50%',
					style: {
						text: String(total),
						fontSize: 22,
						fontWeight: 'bold',
						fill: '#e2e8f0',
						textAlign: 'center',
						textVerticalAlign: 'middle'
					}
				}
			]
		};
	});
</script>

<div class="page">
	<header class="header">
		<div class="header-left">
			<a href="/" class="back-link" aria-label="Back to home">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path
						d="M12.5 15L7.5 10L12.5 5"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</a>
			<h1>Reliability Dashboard</h1>
		</div>
		<div class="header-right">
			<DateRangePicker
				from={reliability.dateRange.from}
				to={reliability.dateRange.to}
				onchange={handleDateChange}
			/>
		</div>
	</header>

	<main class="content">
		{#if !serverId}
			<div class="empty-state">
				<p>Connect to a gateway to view reliability data</p>
			</div>
		{:else if loading && !summary}
			<div class="loading-state">
				<p>Loading...</p>
			</div>
		{:else}
			<!-- KPI Cards -->
			<section class="kpi-row">
				<KpiCard
					label="Total Events"
					value={String(summary?.total ?? 0)}
					icon="⚡"
					color="--accent"
				/>
				<KpiCard
					label="Critical"
					value={String(summary?.bySeverity?.critical ?? 0)}
					icon="🔴"
					color="--red"
				/>
				<KpiCard
					label="Cron Issues"
					value={String(summary?.byCategory?.cron ?? 0)}
					icon="⏱"
					color="--amber"
				/>
				<KpiCard
					label="Browser Issues"
					value={String(summary?.byCategory?.browser ?? 0)}
					icon="🌐"
					color="--purple"
				/>
			</section>

			<!-- Timeline Chart -->
			<section class="chart-card">
				<Chart options={timelineOptions} height="300px" />
			</section>

			<!-- Two column: Top Events + Severity Distribution -->
			<section class="two-col">
				<div class="chart-card">
					<Chart options={topEventsOptions} height="300px" />
				</div>
				<div class="chart-card">
					<Chart options={severityOptions} height="300px" />
				</div>
			</section>

			<!-- Incident Table -->
			<section class="table-section">
				<IncidentTable events={reliability.events} title="Recent Incidents" />
			</section>
		{/if}
	</main>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--bg, #0a0e17);
		color: var(--text, #e2e8f0);
	}

	.header {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 24px;
		background: var(--bg2, #111827);
		border-bottom: 1px solid var(--border, #2a3548);
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.back-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--text2, #94a3b8);
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}

	.back-link:hover {
		background: var(--bg3, #1e293b);
		color: var(--text, #e2e8f0);
	}

	h1 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.header-right {
		display: flex;
		align-items: center;
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.empty-state,
	.loading-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.empty-state p,
	.loading-state p {
		color: var(--text3, #64748b);
		font-size: 14px;
	}

	.kpi-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
	}

	.chart-card {
		background: var(--card, #151d2e);
		border: 1px solid var(--border, #2a3548);
		border-radius: var(--radius, 10px);
		padding: 8px;
		overflow: hidden;
	}

	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.table-section {
		min-width: 0;
	}

	/* Responsive: stack on narrow screens */
	@media (max-width: 900px) {
		.kpi-row {
			grid-template-columns: repeat(2, 1fr);
		}
		.two-col {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.kpi-row {
			grid-template-columns: 1fr;
		}
		.header {
			flex-direction: column;
			gap: 12px;
			align-items: flex-start;
		}
	}
</style>
