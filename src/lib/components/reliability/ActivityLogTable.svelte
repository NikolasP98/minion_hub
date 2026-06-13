<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import {
		Activity,
		ChevronRight,
		ChevronLeft,
		ChevronUp,
		ChevronDown,
		ChevronsUpDown,
		Search,
	} from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import {
		createTable,
		getCoreRowModel,
		getSortedRowModel,
		getPaginationRowModel,
	} from '@tanstack/svelte-table';
	import type { ColumnDef, SortingState, PaginationState } from '@tanstack/svelte-table';
	import Fuse from 'fuse.js';
	import type { ReliabilityEvent } from '$lib/state/reliability/reliability.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import PanelHeader from './PanelHeader.svelte';

	type IconComponent = typeof Activity;

	// Shared, reusable "Activity Log" explorer. Renders a date-ranged / pre-filtered
	// `events` list as a sortable, searchable, paginated table with expandable
	// metadata rows — optionally with a category drill-down tab-bar and a scatter
	// timeline. Powers both the Overview activity log (full taxonomy) and the
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
	let searchQuery = $state('');
	let expandedId = $state<string | null>(null);

	const CATEGORY_COLORS: Record<string, string> = {
		gateway: '#4ade80',
		agent: '#f472b6',
		tool: '#a855f7',
		message: '#06b6d4',
		channel: '#f59e0b',
		orchestration: '#ec4899',
		skill: '#22d3ee',
		crash: '#fb7185',
		connection: '#14b8a6',
		auth: '#34d399',
		cron: '#60a5fa',
		memory: '#8b5cf6',
		heartbeat: '#f43f5e',
	};

	const SEVERITY_Y: Record<string, number> = {
		critical: 3,
		high: 2,
		medium: 1,
		low: 0,
		info: -1,
	};

	// Severity = ordinal alarm ramp; aligned with the page palette (council 2026-05-29).
	const severityClasses: Record<string, string> = {
		critical: 'bg-destructive text-white',
		high: 'bg-warning text-black',
		medium: 'bg-purple text-white',
		low: 'bg-muted-foreground text-white',
		info: 'bg-accent/80 text-white',
		ok: 'bg-success text-white',
	};

	const severityRowBorder: Record<string, string> = {
		critical: 'border-l-2 border-l-destructive',
		high: 'border-l-2 border-l-warning',
		medium: 'border-l-2 border-l-purple',
		low: 'border-l-2 border-l-muted-foreground/30',
		info: 'border-l-2 border-l-accent/40',
		ok: 'border-l-2 border-l-success',
	};

	const categoryClasses: Record<string, string> = {
		gateway: 'bg-emerald/15 text-emerald border border-emerald/30',
		agent: 'bg-pink/15 text-pink border border-pink/30',
		tool: 'bg-purple/15 text-purple border border-purple/30',
		message: 'bg-cyan/15 text-cyan border border-cyan/30',
		channel: 'bg-warning/15 text-warning border border-warning/30',
		orchestration: 'bg-pink/15 text-pink border border-pink/30',
		skill: 'bg-cyan/15 text-cyan border border-cyan/30',
		crash: 'bg-destructive/15 text-destructive border border-destructive/30',
		connection: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
		auth: 'bg-success/15 text-success border border-success/30',
		cron: 'bg-accent/15 text-accent border border-accent/30',
		browser: 'bg-warning/15 text-warning border border-warning/30',
		timezone: 'bg-purple/15 text-purple border border-purple/30',
		general: 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30',
		memory: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
		heartbeat: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
	};

	const HeaderIcon = $derived(icon ?? Activity);

	// ── Filtering pipeline: category tab → fuzzy search ───────────────────────
	let categoryFiltered = $derived.by(() =>
		selectedCategory === 'all' ? events : events.filter((e) => e.category === selectedCategory),
	);

	let filteredData = $derived.by(() => {
		if (!searchQuery.trim()) return categoryFiltered;
		const fuse = new Fuse(categoryFiltered, {
			keys: ['event', 'message', 'category', 'severity'],
			threshold: 0.4,
			ignoreLocation: true,
		});
		return fuse.search(searchQuery).map((r) => r.item);
	});

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

	// ── TanStack table (sort + paginate) ──────────────────────────────────────
	const SEVERITY_ORDER: Record<string, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 4,
		ok: 5,
	};
	const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

	let sorting = $state<SortingState>([{ id: 'timestamp', desc: true }]);
	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 50 });

	// Reset to first page when the filtered set changes (search / tab / data).
	$effect(() => {
		filteredData;
		pagination = { pageSize: untrack(() => pagination.pageSize), pageIndex: 0 };
	});

	const columns: ColumnDef<ReliabilityEvent, any>[] = [
		{
			id: 'timestamp',
			accessorFn: (row) => row.timestamp,
			header: m.reliability_time(),
			size: 90,
			minSize: 70,
			sortingFn: 'basic',
		},
		{
			id: 'severity',
			accessorFn: (row) => row.severity,
			header: m.reliability_severity(),
			size: 90,
			minSize: 70,
			sortingFn: (a, b) =>
				(SEVERITY_ORDER[a.getValue('severity') as string] ?? 9) -
				(SEVERITY_ORDER[b.getValue('severity') as string] ?? 9),
		},
		{
			id: 'category',
			accessorKey: 'category',
			header: m.reliability_category(),
			size: 100,
			minSize: 80,
		},
		{
			id: 'event',
			accessorKey: 'event',
			header: m.reliability_event(),
			size: 220,
			minSize: 120,
		},
		{
			id: 'message',
			accessorKey: 'message',
			header: m.reliability_message(),
			size: 400,
			minSize: 100,
		},
	];

	const table = createTable({
		get data() {
			return filteredData;
		},
		columns,
		state: {
			get sorting() {
				return sorting;
			},
			get pagination() {
				return pagination;
			},
		},
		onSortingChange: (updater: any) => {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
		},
		onPaginationChange: (updater: any) => {
			pagination = typeof updater === 'function' ? updater(pagination) : updater;
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	let totalRows = $derived(table.getFilteredRowModel().rows.length);
	let pageStart = $derived(pagination.pageIndex * pagination.pageSize + 1);
	let pageEnd = $derived(Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalRows));
	let canPrev = $derived(table.getCanPreviousPage());
	let canNext = $derived(table.getCanNextPage());

	// ── Scatter timeline (individual events by severity over time) ────────────
	let chartOptions: EChartsOption = $derived.by(() => {
		if (filteredData.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 60, right: 24, top: 28, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value', show: false },
				series: [],
			};
		}

		const groups = new Map<string, ReliabilityEvent[]>();
		for (const ev of filteredData) {
			const g = groups.get(ev.category) ?? [];
			g.push(ev);
			groups.set(ev.category, g);
		}

		const series = [...groups.entries()].map(([cat, evts]) => ({
			name: cat,
			type: 'scatter' as const,
			symbolSize: 8,
			data: evts.map((ev) => [ev.timestamp, SEVERITY_Y[ev.severity] ?? 0]),
			itemStyle: { color: CATEGORY_COLORS[cat] ?? '#64748b' },
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
					return `<div style="font-size:11px"><div style="margin-bottom:4px;color:var(--color-muted-foreground)">${t}</div><div><strong>${ev.event}</strong></div><div style="color:var(--color-muted-foreground)">${ev.message}</div><div style="margin-top:2px;font-size:10px;color:var(--color-muted-foreground)">${ev.category} / ${ev.severity}</div></div>`;
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
	function getRowId(evt: ReliabilityEvent, i: number): string {
		return evt.id != null ? String(evt.id) : `${i}:${evt.timestamp}:${evt.event}`;
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

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
		expandedId = null;
	}
</script>

<div class="surface-2 w-full rounded-lg overflow-hidden {className}">
	<!-- Header: title + count + search + pagination -->
	<PanelHeader label={title ?? m.reliability_activityLog()} labelClass="shrink-0" class="flex-wrap gap-y-1.5">
		{#snippet icon()}
			<HeaderIcon size={11} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<span class="text-[10px] text-muted-foreground tabular-nums shrink-0">
				{formatNumber(totalCount)}
				{m.reliability_events()}
			</span>

			{#if searchable}
				<!-- Search -->
				<div class="relative ml-2">
					<Search
						size={11}
						class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-strong pointer-events-none"
					/>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder={m.reliability_incidentSearch()}
						class="h-6 w-40 pl-6 pr-2 text-[11px] bg-bg3/60 border border-border rounded text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/50"
					/>
				</div>
			{/if}

			<div class="flex-1"></div>

			{#if filteredData.length > 0}
				<select
					bind:value={pagination.pageSize}
					onchange={() => (pagination = { ...pagination, pageIndex: 0 })}
					class="h-6 px-1.5 text-[11px] bg-bg3/60 border border-border rounded text-foreground cursor-pointer focus:outline-none focus:border-accent/50"
				>
					{#each PAGE_SIZE_OPTIONS as size (size)}
						<option value={size}>{size}</option>
					{/each}
				</select>

				<button
					type="button"
					class="flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:not-disabled:text-foreground hover:not-disabled:bg-border"
					disabled={!canPrev}
					onclick={() => table.previousPage()}
				>
					<ChevronLeft size={12} />
				</button>

				<span class="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
					{#if totalRows > 0}
						{pageStart}–{pageEnd} of {totalRows}
					{:else}
						0 of 0
					{/if}
				</span>

				<button
					type="button"
					class="flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:not-disabled:text-foreground hover:not-disabled:bg-border"
					disabled={!canNext}
					onclick={() => table.nextPage()}
				>
					<ChevronRight size={12} />
				</button>
			{/if}
		{/snippet}
	</PanelHeader>

	<!-- Category drill-down tabs -->
	{#if categories && categories.length > 0}
		<div class="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
			{#each categories as cat (cat)}
				{@const count = tabCount(cat)}
				<button
					type="button"
					class="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors {selectedCategory ===
					cat
						? 'bg-accent/20 text-accent'
						: 'text-muted-foreground hover:text-foreground hover:bg-card'}"
					onclick={() => selectCategory(cat)}
				>
					{cat}
					{#if count > 0}
						<span class="ml-0.5 text-[9px] opacity-70">({formatNumber(count)})</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			{emptyMessage ?? m.reliability_noEvents()}
		</div>
	{:else}
		{#if truncated}
			<p class="px-3 pt-1.5 text-[10px] text-muted-strong tabular-nums">
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

		{#if filteredData.length === 0}
			<div
				class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px] border-t border-border"
			>
				{m.reliability_incidentNoMatch({ query: searchQuery })}
			</div>
		{:else}
			<!-- Event table -->
			<div class="overflow-x-auto border-t border-border">
				<table class="w-full border-collapse">
					<thead>
						<tr class="bg-bg3/40 sticky top-0 z-[1]">
							<th class="w-6 py-1 px-0 border-b border-border"></th>
							{#each table.getHeaderGroups()[0].headers as header (header.id)}
								{@const sorted = header.column.getIsSorted()}
								{@const SortIcon =
									sorted === 'asc' ? ChevronUp : sorted === 'desc' ? ChevronDown : ChevronsUpDown}
								<th
									class="py-1 px-2 text-left border-b border-border cursor-pointer select-none hover:text-foreground transition-colors"
									style="width:{header.getSize()}px"
									onclick={header.column.getToggleSortingHandler()}
								>
									<span
										class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
									>
										{header.column.columnDef.header}
										<SortIcon size={10} class="shrink-0 {sorted ? 'text-accent' : 'opacity-40'}" />
									</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each table.getRowModel().rows as row, i (row.original.id ?? `${i}:${row.original.timestamp}:${row.original.event}`)}
							{@const evt = row.original}
							{@const rowId = getRowId(evt, row.index)}
							{@const isExpanded = expandedId === rowId}
							{@const expandable = hasMetadata(evt)}
							<tr
								class="border-b border-border/40 hover:bg-white/[0.025] focus-visible:outline-none focus-visible:bg-white/[0.04] {severityRowBorder[
									evt.severity
								] ?? ''} {expandable ? 'cursor-pointer' : ''}"
								tabindex={expandable ? 0 : undefined}
								aria-expanded={expandable ? isExpanded : undefined}
								onclick={() => expandable && toggleExpand(rowId)}
								onkeydown={expandable
									? (e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												toggleExpand(rowId);
											}
										}
									: undefined}
							>
								<td class="w-6 py-0.5 px-0.5 align-middle text-center">
									{#if expandable}
										<span
											class="inline-flex items-center justify-center transition-transform duration-150 {isExpanded
												? 'rotate-90'
												: ''}"
										>
											<ChevronRight size={10} class="text-muted-foreground" />
										</span>
									{/if}
								</td>
								<td
									class="py-0.5 px-2 text-[11px] text-muted-foreground tabular-nums cursor-default align-middle font-mono"
									style="width:{columns[0].size}px"
									title={formatFullDate(evt.timestamp)}
								>
									{formatRelativeTime(evt.timestamp)}
								</td>
								<td class="py-0.5 px-2 text-[11px] align-middle" style="width:{columns[1].size}px">
									<span
										class="inline-block text-[9px] font-semibold py-px px-1.5 rounded leading-snug whitespace-nowrap {severityClasses[
											evt.severity
										] ?? ''}">{evt.severity}</span
									>
								</td>
								<td class="py-0.5 px-2 text-[11px] align-middle" style="width:{columns[2].size}px">
									<span
										class="inline-block text-[9px] font-semibold py-px px-1.5 rounded leading-snug whitespace-nowrap {categoryClasses[
											evt.category
										] ?? 'bg-muted-foreground/20 text-muted-foreground'}">{evt.category}</span
									>
								</td>
								<td
									class="py-0.5 px-2 text-[11px] text-foreground align-middle font-mono max-w-0 truncate"
									style="width:{columns[3].size}px"
									title={evt.event}
								>
									{evt.event}
								</td>
								<td
									class="py-0.5 px-2 text-[11px] text-muted-foreground align-middle max-w-0 truncate"
									title={evt.message}
								>
									{evt.message}
								</td>
							</tr>
							{#if isExpanded}
								<tr class="bg-bg3/30">
									<td colspan="6" class="py-1.5 px-3">
										<div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
											{#if evt.agentId}
												<div class="flex items-center gap-2">
													<span class="text-muted-foreground font-medium">agentId:</span>
													<span class="text-foreground font-mono text-[11px]">{evt.agentId}</span>
												</div>
											{/if}
											{#if evt.correlationId}
												<div class="flex items-center gap-2">
													<span class="text-muted-foreground font-medium">correlationId:</span>
													<span
														class="text-foreground/60 font-mono text-[11px] truncate max-w-[220px]"
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
																		<span class="text-muted-strong text-[10px]">{subKey}</span>
																		<span class="text-foreground font-mono tabular-nums text-[11px]">
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
																	class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md bg-accent/15 text-accent border border-accent/30"
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
																	class="bg-bg3/60 text-foreground/80 px-1.5 py-0.5 rounded text-[11px] font-mono break-all"
																	>{formatted.text}</code
																>
															{:else if formatted.style === 'id'}
																<span
																	class="text-foreground/60 font-mono text-[11px] truncate max-w-[220px]"
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
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>
