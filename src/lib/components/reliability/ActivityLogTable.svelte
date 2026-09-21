<script lang="ts">
	import { Button } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import { Activity } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
	import type { ReliabilityEvent } from '$lib/state/reliability/reliability.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import PanelHeader from './PanelHeader.svelte';
	import { chartColors } from '$lib/utils/chart-colors';

	type IconComponent = typeof Activity;

	// Shared, reusable "Activity Log" explorer. Renders a date-ranged / pre-filtered
	// `events` list as a sortable, searchable table (via the shared DataTable) with
	// expandable metadata rows — optionally with a category drill-down tab-bar and a
	// scatter timeline. Powers both the Overview activity log (full taxonomy) and the
	// Agents tab's agent-activity-only log. The parent owns date-ranging and any
	// cross-filtering; this component just renders what it's given.
	let {
		events = [],
		total,
		byCategory,
		categories,
		title,
		icon,
		showTimeline = false,
		timelineOptions,
		timelineHeight = '160px',
		onTimelineClick,
		searchable = true,
		emptyMessage,
		class: className = '',
	}: {
		events: ReliabilityEvent[];
		/** True total for the range (server SQL). Falls back to events.length. */
		total?: number;
		/** Per-category counts for tab badges. Falls back to client-side counts. */
		byCategory?: Record<string, number>;
		/** Drill-down category tabs. If omitted, no tab-bar is rendered. */
		categories?: string[];
		/** Header label. Defaults to the shared "Activity Log" string. */
		title?: string;
		/** Header icon component (lucide). Defaults to Activity. */
		icon?: IconComponent;
		/** Render a chart above the table. With `timelineOptions` it renders that
		 *  (e.g. the Event Timeline); otherwise it falls back to the built-in
		 *  severity-over-time scatter. */
		showTimeline?: boolean;
		/** When provided, replaces the scatter with this chart (the Event Timeline). */
		timelineOptions?: EChartsOption;
		/** Height for the chart above the table (taller for the bar timeline). */
		timelineHeight?: string;
		/** Click handler for the supplied timeline chart (e.g. filter by category). */
		onTimelineClick?: (params: unknown) => void;
		searchable?: boolean;
		emptyMessage?: string;
		class?: string;
	} = $props();

	let selectedCategory = $state<string>('all');

	// Scatter-timeline series colors, resolved from theme tokens at build time so
	// the chart recolors with the active theme. Mirrors the `categoryClasses`
	// badge palette below.
	let palette = $derived(chartColors());
	let CATEGORY_COLORS = $derived<Record<string, string>>({
		gateway: palette.emerald,
		agent: palette.pink,
		tool: palette.purple,
		message: palette.cyan,
		channel: palette.warning,
		orchestration: palette.pink,
		skill: palette.cyan,
		crash: palette.destructive,
		connection: palette.cyan,
		session: palette.accent,
		auth: palette.info,
		cron: palette.info,
		memory: palette.purple,
		heartbeat: palette.pink,
	});

	const SEVERITY_Y: Record<string, number> = {
		critical: 3,
		high: 2,
		medium: 1,
		low: 0,
		info: -1,
	};

	// Severity = ordinal alarm ramp (council 2026-05-29), same semantic status hue as
	// +page.svelte SEVERITY_COLORS so a level reads identically on every surface.
	// Uses the STATUS TRIPLE (surface bg + fg text + border), NOT a solid fill:
	// `--color-{status}` aliases the FG text colour (dark) and `text-primary-foreground`
	// is undefined → solid `bg-{status} text-primary-foreground` = dark-on-dark. The
	// tinted triple is the sanctioned readable pattern (matches the category chips).
	const severityClasses: Record<string, string> = {
		critical: 'bg-destructive/15 text-destructive border border-destructive/30',
		high: 'bg-warning/15 text-warning border border-warning/30',
		medium: 'bg-warning/15 text-warning border border-warning/30',
		low: 'bg-surface-3 text-foreground',
		info: 'bg-info/15 text-info border border-info/30',
		ok: 'bg-success/15 text-success border border-success/30',
	};

	// Row-severity tint, applied as a left border on the table's first (custom)
	// cell — DataTable columns don't carry per-row classes, so this is the
	// smallest faithful equivalent of the old whole-row `border-l-2`.
	const severityRowBorder: Record<string, string> = {
		critical: 'border-l-2 border-l-destructive',
		high: 'border-l-2 border-l-warning',
		medium: 'border-l-2 border-l-warning',
		low: 'border-l-2 border-l-muted-foreground/30',
		info: 'border-l-2 border-l-info/40',
		ok: 'border-l-2 border-l-success',
	};

	const categoryClasses: Record<string, string> = {
		gateway: 'bg-success/15 text-success border border-success/30',
		agent: 'bg-accent/15 text-accent border border-accent/30',
		tool: 'bg-info/15 text-info border border-info/30',
		message: 'bg-info/15 text-info border border-info/30',
		channel: 'bg-warning/15 text-warning border border-warning/30',
		orchestration: 'bg-accent/15 text-accent border border-accent/30',
		skill: 'bg-info/15 text-info border border-info/30',
		crash: 'bg-destructive/15 text-destructive border border-destructive/30',
		connection: 'bg-info/15 text-info border border-info/30',
		auth: 'bg-info/15 text-info border border-info/30',
		cron: 'bg-accent/15 text-accent border border-accent/30',
		browser: 'bg-warning/15 text-warning border border-warning/30',
		timezone: 'bg-accent/15 text-accent border border-accent/30',
		general: 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30',
		memory: 'bg-accent/15 text-accent border border-accent/30',
		heartbeat: 'bg-destructive/15 text-destructive border border-destructive/30',
	};

	const HeaderIcon = $derived(icon ?? Activity);

	// ── Filtering pipeline: category tab (search is now handled inside DataTable) ──
	let categoryFiltered = $derived.by(() =>
		selectedCategory === 'all' ? events : events.filter((e) => e.category === selectedCategory),
	);

	const totalCount = $derived(total ?? events.length);

	// Client-side category counts when the parent doesn't supply server totals.
	let clientByCategory = $derived.by(() => {
		if (byCategory) return byCategory;
		const map = new SvelteMap<string, number>();
		for (const e of events) map.set(e.category, (map.get(e.category) ?? 0) + 1);
		return Object.fromEntries(map);
	});

	const loadedCount = $derived(events.length);
	const truncated = $derived(totalCount > loadedCount);

	function tabCount(cat: string): number {
		if (cat === 'all') return totalCount;
		return clientByCategory[cat] ?? 0;
	}

	// ── DataTable columns ──────────────────────────────────────────────────────
	const SEVERITY_ORDER: Record<string, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 4,
		ok: 5,
	};

	const columns: DataColumn<ReliabilityEvent>[] = [
		{
			key: 'time',
			label: m.reliability_time(),
			accessor: (row) => row.timestamp,
			custom: true,
			width: 90,
		},
		{
			key: 'severity',
			label: m.reliability_severity(),
			accessor: (row) => row.severity,
			custom: true,
			width: 90,
			sortFn: (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
		},
		{
			key: 'category',
			label: m.reliability_category(),
			accessor: (row) => row.category,
			custom: true,
			width: 100,
		},
		{
			key: 'event',
			label: m.reliability_event(),
			accessor: (row) => row.event,
			custom: true,
			width: 220,
		},
		{
			key: 'message',
			label: m.reliability_message(),
			accessor: (row) => row.message,
			custom: true,
			fill: true,
		},
	];

	function rowId(evt: ReliabilityEvent): string {
		return evt.id != null ? String(evt.id) : `${evt.timestamp}:${evt.event}`;
	}

	// ── Scatter timeline (individual events by severity over time) ────────────
	// Reflects the category tab only — the free-text search box now lives inside
	// DataTable's own toolbar and no longer narrows this chart (see report).
	let chartOptions: EChartsOption = $derived.by(() => {
		if (categoryFiltered.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 60, right: 24, top: 28, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value', show: false },
				series: [],
			};
		}

		const groups = new Map<string, ReliabilityEvent[]>();
		for (const ev of categoryFiltered) {
			const g = groups.get(ev.category) ?? [];
			g.push(ev);
			groups.set(ev.category, g);
		}

		const series = [...groups.entries()].map(([cat, evts]) => ({
			name: cat,
			type: 'scatter' as const,
			symbolSize: 8,
			data: evts.map((ev) => [ev.timestamp, SEVERITY_Y[ev.severity] ?? 0]),
			itemStyle: { color: CATEGORY_COLORS[cat] ?? palette.neutral },
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: (params: any) => {
					const idx = params.dataIndex as number;
					const group = groups.get(params.seriesName as string);
					const ev = group?.[idx];
					if (!ev) return '';
					const d = new Date(ev.timestamp);
					const t = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
					return `<div style="font-size: var(--font-size-label, 11px)"><div style="margin-bottom:var(--space-1,4px);color:var(--color-muted-foreground)">${t}</div><div><strong>${ev.event}</strong></div><div style="color:var(--color-muted-foreground)">${ev.message}</div><div style="margin-top:var(--space-0-5,2px);font-size: var(--font-size-caption, 10px);color:var(--color-muted-foreground)">${ev.category} / ${ev.severity}</div></div>`;
				},
			},
			legend: { top: 0, right: 8, textStyle: { fontSize: 10 } },
			grid: { left: 60, right: 24, top: 28, bottom: 32 },
			xAxis: {
				type: 'time',
				axisLabel: {
					fontSize: 10,
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
					},
				},
				axisTick: { show: false },
				splitLine: { show: false },
			},
			yAxis: {
				type: 'value',
				min: -2,
				max: 4,
				axisLabel: {
					fontSize: 9,
					formatter: (value: number) => {
						const labels: Record<number, string> = {
							3: 'critical',
							2: 'high',
							1: 'medium',
							0: 'low',
							[-1]: 'info',
						};
						return labels[value] ?? '';
					},
				},
				axisLine: { show: false },
				axisTick: { show: false },
			},
			series,
		} satisfies EChartsOption;
	});

	// ── Row helpers ───────────────────────────────────────────────────────────
	function parseMetadata(raw: unknown): Record<string, unknown> | null {
		if (raw == null) return null;
		if (typeof raw === 'string') {
			try {
				return JSON.parse(raw);
			} catch {
				return null;
			}
		}
		if (typeof raw === 'object') return raw as Record<string, unknown>;
		return null;
	}

	function hasMetadata(evt: ReliabilityEvent): boolean {
		const meta = parseMetadata(evt.metadata);
		return (meta != null && Object.keys(meta).length > 0) || !!evt.agentId || !!evt.correlationId;
	}

	function isNestedObject(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	function formatNumber(n: number): string {
		return n.toLocaleString('en-US');
	}

	function formatMetaValue(
		key: string,
		value: unknown,
	): {
		text: string;
		style: 'plain' | 'pill' | 'code' | 'status-ok' | 'status-err' | 'duration' | 'id' | 'number';
	} {
		if (key === 'durationMs' && typeof value === 'number') {
			const text = value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
			return { text, style: 'duration' };
		}
		if (key === 'statusCode') {
			const code = Number(value);
			return { text: String(value), style: code >= 200 && code < 300 ? 'status-ok' : 'status-err' };
		}
		if (key === 'provider' || key === 'channel' || key === 'source') return { text: String(value), style: 'pill' };
		if (key.endsWith('Id') && typeof value === 'string' && value.length > 20)
			return { text: String(value), style: 'id' };
		if (key === 'error' || key === 'jobId') return { text: String(value), style: 'code' };
		if (typeof value === 'number') return { text: formatNumber(value), style: 'number' };
		return { text: String(value), style: 'plain' };
	}

	function formatRelativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		if (seconds < 60) return `${seconds}s ago`;
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	}

	function formatFullDate(timestamp: number): string {
		return new Date(timestamp).toISOString();
	}

	function selectCategory(cat: string) {
		selectedCategory = cat;
	}
</script>

<div class="surface-2 w-full rounded-lg overflow-hidden flex flex-col {className}">
	<!-- Header: title + count -->
	<PanelHeader label={title ?? m.reliability_activityLog()} labelClass="shrink-0" class="flex-wrap gap-y-1.5">
		{#snippet icon()}
			<HeaderIcon size={11} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<span class="text-xs text-muted-foreground tabular-nums shrink-0">
				{formatNumber(totalCount)}
				{m.reliability_events()}
			</span>
		{/snippet}
	</PanelHeader>

	<!-- Category drill-down tabs -->
	{#if categories && categories.length > 0}
		<div class="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
			{#each categories as cat (cat)}
				{@const count = tabCount(cat)}
				<Button
					type="button"
					variant={selectedCategory === cat ? 'primary' : 'secondary'}
					size="sm"
					class="shrink-0"
					aria-pressed={selectedCategory === cat}
					onclick={() => selectCategory(cat)}
				>
					{cat}
					{#if count > 0}
						<span class="ml-0.5 text-xs opacity-70">({formatNumber(count)})</span>
					{/if}
				</Button>
			{/each}
		</div>
	{/if}

	{#if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-sm">
			{emptyMessage ?? m.reliability_noEvents()}
		</div>
	{:else}
		{#if truncated}
			<p class="px-3 pt-1.5 text-xs text-muted-strong tabular-nums">
				{m.reliability_showingOfTotal({
					shown: formatNumber(loadedCount),
					total: formatNumber(totalCount),
				})}
			</p>
		{/if}
		{#if showTimeline}
			<!-- Prefer the supplied chart (Event Timeline) over the built-in scatter. -->
			{#if timelineOptions}
				<Chart options={timelineOptions} height={timelineHeight} onItemClick={onTimelineClick} />
			{:else}
				<Chart options={chartOptions} height="160px" />
			{/if}
		{/if}

		<!-- Event table -->
		<div class="border-t border-border flex-1 min-h-0 log-pane">
			<DataTable
				class="h-full"
				data={categoryFiltered}
				{columns}
				getRowId={rowId}
				{searchable}
				searchPlaceholder={m.reliability_incidentSearch()}
				searchFields={(e) => `${e.event} ${e.message} ${e.category} ${e.severity}`}
				initialSort={{ key: 'time', dir: 'desc' }}
				isExpandable={(e) => hasMetadata(e)}
				emptyMessage={emptyMessage ?? m.reliability_noEvents()}
			>
				{#snippet cell(evt: ReliabilityEvent, column: DataColumn<ReliabilityEvent>)}
					{#if column.key === 'time'}
						<span
							class="block -ml-3 -my-2 py-2 pl-3 font-mono text-xs text-muted-foreground tabular-nums {severityRowBorder[
								evt.severity
							] ?? ''}"
							title={formatFullDate(evt.timestamp)}
						>
							{formatRelativeTime(evt.timestamp)}
						</span>
					{:else if column.key === 'severity'}
						<span
							class="inline-block text-xs font-semibold py-px px-1.5 rounded leading-snug whitespace-nowrap {severityClasses[
								evt.severity
							] ?? ''}">{evt.severity}</span
						>
					{:else if column.key === 'category'}
						<span
							class="inline-block text-xs font-semibold py-px px-1.5 rounded leading-snug whitespace-nowrap {categoryClasses[
								evt.category
							] ?? 'bg-muted-foreground/20 text-muted-foreground'}">{evt.category}</span
						>
					{:else if column.key === 'event'}
						<span class="font-mono text-xs text-foreground" title={evt.event}>{evt.event}</span>
					{:else if column.key === 'message'}
						<span class="text-xs text-muted-foreground" title={evt.message}>{evt.message}</span>
					{/if}
				{/snippet}
				{#snippet expandedContent(evt: ReliabilityEvent)}
					<div class="py-1.5 px-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
						{#if evt.agentId}
							<div class="flex items-center gap-2">
								<span class="text-muted-foreground font-medium">agentId:</span>
								<span class="text-foreground font-mono text-xs">{evt.agentId}</span>
							</div>
						{/if}
						{#if evt.correlationId}
							<div class="flex items-center gap-2">
								<span class="text-muted-foreground font-medium">correlationId:</span>
								<span
									class="text-foreground/60 font-mono text-xs truncate max-w-[220px]"
									title={evt.correlationId}>{evt.correlationId}</span
								>
							</div>
						{/if}
						{#if parseMetadata(evt.metadata)}
							{#each Object.entries(parseMetadata(evt.metadata)!) as [key, value] (key)}
								{#if isNestedObject(value)}
									<div class="col-span-2 flex items-center gap-2 flex-wrap">
										<span class="text-muted-foreground font-medium shrink-0">{key}:</span>
										<div class="flex items-center gap-1.5 flex-wrap">
											{#each Object.entries(value) as [subKey, subVal] (subKey)}
												<span
													class="inline-flex items-center gap-1 bg-bg3/60 rounded px-1.5 py-0.5"
												>
													<span class="text-muted-strong text-xs">{subKey}</span>
													<span class="text-foreground font-mono tabular-nums text-xs">
														{typeof subVal === 'number'
															? formatNumber(subVal)
															: String(subVal)}
													</span>
												</span>
											{/each}
										</div>
									</div>
								{:else}
									{@const formatted = formatMetaValue(key, value)}
									<div
										class="flex items-center gap-2 {formatted.style === 'code' &&
										String(value).length > 60
											? 'col-span-2'
											: ''}"
									>
										<span class="text-muted-foreground font-medium">{key}:</span>
										{#if formatted.style === 'pill'}
											<span
												class="inline-block text-xs font-semibold py-0.5 px-2 rounded-md bg-accent/15 text-accent border border-accent/30"
												>{formatted.text}</span
											>
										{:else if formatted.style === 'status-ok'}
											<span class="text-success font-mono tabular-nums">{formatted.text}</span>
										{:else if formatted.style === 'status-err'}
											<span class="text-destructive font-mono tabular-nums"
												>{formatted.text}</span
											>
										{:else if formatted.style === 'duration'}
											<span class="text-foreground font-mono tabular-nums">{formatted.text}</span
											>
										{:else if formatted.style === 'code'}
											<code
												class="bg-bg3/60 text-foreground/80 px-1.5 py-0.5 rounded text-xs font-mono break-all"
												>{formatted.text}</code
											>
										{:else if formatted.style === 'id'}
											<span
												class="text-foreground/60 font-mono text-xs truncate max-w-[220px]"
												title={formatted.text}>{formatted.text}</span
											>
										{:else if formatted.style === 'number'}
											<span class="text-foreground font-mono tabular-nums">{formatted.text}</span
											>
										{:else}
											<span class="text-foreground">{formatted.text}</span>
										{/if}
									</div>
								{/if}
							{/each}
						{/if}
					</div>
				{/snippet}
			</DataTable>
		</div>
	{/if}
</div>

<style>
  /* ponytail: fixed pane height — no height token exists; bump if the dashboard grid changes. */
  .log-pane {
    height: 26rem;
  }
</style>
