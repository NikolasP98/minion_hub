<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import KpiCard from '$lib/components/reliability/KpiCard.svelte';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import IncidentTable from '$lib/components/reliability/IncidentTable.svelte';
	import CredentialHealthPanel from '$lib/components/reliability/CredentialHealthPanel.svelte';
	import SkillStatsPanel from '$lib/components/reliability/SkillStatsPanel.svelte';
	import GatewayHealthPanel from '$lib/components/reliability/GatewayHealthPanel.svelte';
	import ScanLine from '$lib/components/decorations/ScanLine.svelte';
	import DotMatrix from '$lib/components/decorations/DotMatrix.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents
	} from '$lib/state/reliability.svelte';
	import { hostsState } from '$lib/state/hosts.svelte';
	import { onMount, untrack } from 'svelte';
	import type { EChartsOption } from 'echarts';

	/** Generate a small 8-value DotMatrix data array from a numeric KPI value (0–100+ range). */
	function kpiToMatrix(val: number, max = 100): number[] {
		const norm = Math.min(val / max, 1);
		return Array.from({ length: 8 }, (_, i) => {
			const threshold = (i + 1) / 8;
			return norm >= threshold ? 0.8 : 0.15;
		});
	}

	const CATEGORY_COLORS: Record<string, string> = {
		cron: '#3b82f6',
		browser: '#f59e0b',
		timezone: '#a855f7',
		general: '#64748b',
		auth: '#22c55e',
		skill: '#06b6d4',
		agent: '#ec4899',
		gateway: '#10b981'
	};

	const SEVERITY_COLORS: Record<string, string> = {
		critical: '#ef4444',
		high: '#f59e0b',
		medium: '#a855f7',
		low: '#64748b'
	};

	const CATEGORIES = ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'] as const;

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

<div class="relative z-10 flex flex-col h-screen text-foreground">
	<header class="sticky top-0 z-10 flex items-center justify-between py-3 px-6 bg-bg2 border-b border-border shrink-0 max-sm:flex-col max-sm:gap-3 max-sm:items-start">
		<div class="flex items-center gap-3">
			<a href="/" class="flex items-center justify-center w-8 h-8 rounded-lg text-muted no-underline transition-colors duration-150 hover:bg-bg3 hover:text-foreground" aria-label="Back to home">
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
			<h1 class="text-base font-semibold tracking-tight">Reliability Dashboard</h1>
		</div>
		<div class="flex items-center">
			<DateRangePicker
				from={reliability.dateRange.from}
				to={reliability.dateRange.to}
				onchange={handleDateChange}
			/>
		</div>
	</header>

	<main class="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
		{#if !serverId}
			<div class="flex-1 flex items-center justify-center">
				<p class="text-muted-foreground text-sm">Connect to a gateway to view reliability data</p>
			</div>
		{:else if loading && !summary}
			<div class="flex-1 flex items-center justify-center">
				<p class="text-muted-foreground text-sm">Loading...</p>
			</div>
		{:else}
			<!-- KPI Cards -->
			<section class="grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Total Events"
						value={String(summary?.total ?? 0)}
						icon="⚡"
						color="--accent"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.total ?? 0, 200)} cols={8} />
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Critical"
						value={String(summary?.bySeverity?.critical ?? 0)}
						icon="🔴"
						color="--red"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.bySeverity?.critical ?? 0, 50)} cols={8} color="var(--color-destructive)" />
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Cron Issues"
						value={String(summary?.byCategory?.cron ?? 0)}
						icon="⏱"
						color="--amber"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.byCategory?.cron ?? 0, 50)} cols={8} color="var(--color-warning)" />
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Browser Issues"
						value={String(summary?.byCategory?.browser ?? 0)}
						icon="🌐"
						color="--purple"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.byCategory?.browser ?? 0, 50)} cols={8} color="var(--color-purple)" />
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Auth Issues"
						value={String(summary?.byCategory?.auth ?? 0)}
						icon="🔑"
						color="--green"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.byCategory?.auth ?? 0, 50)} cols={8} color="var(--color-success)" />
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<KpiCard
						label="Gateway"
						value={String(summary?.byCategory?.gateway ?? 0)}
						icon="📡"
						color="--teal"
					/>
					<div class="flex justify-end px-2">
						<DotMatrix data={kpiToMatrix(summary?.byCategory?.gateway ?? 0, 50)} cols={8} />
					</div>
				</div>
			</section>

			<!-- Timeline Chart -->
			<section class="relative bg-card border border-border rounded-lg p-2 overflow-hidden">
				<ScanLine speed={10} opacity={0.02} />
				<Chart options={timelineOptions} height="300px" />
			</section>

			<!-- Two column: Top Events + Severity Distribution -->
			<section class="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
				<div class="relative bg-card border border-border rounded-lg p-2 overflow-hidden">
					<ScanLine speed={10} opacity={0.02} />
					<Chart options={topEventsOptions} height="300px" />
				</div>
				<div class="relative bg-card border border-border rounded-lg p-2 overflow-hidden">
					<ScanLine speed={10} opacity={0.02} />
					<Chart options={severityOptions} height="300px" />
				</div>
			</section>

			<!-- Health Metrics -->
			<section class="flex flex-col gap-4">
				<h2 class="m-0 text-sm font-semibold text-muted tracking-tight">Health Metrics</h2>
				<div class="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
					<CredentialHealthPanel {serverId} />
					<SkillStatsPanel {serverId} />
					<GatewayHealthPanel {serverId} />
				</div>
			</section>

			<!-- Incident Table -->
			<section class="min-w-0">
				<IncidentTable events={reliability.events} title="Recent Incidents" />
			</section>
		{/if}
	</main>
</div>
