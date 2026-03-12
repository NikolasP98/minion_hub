<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, ChevronLeft, Search } from 'lucide-svelte';
	import {
		createTable,
		getCoreRowModel,
		getSortedRowModel,
		getPaginationRowModel,
	} from '@tanstack/svelte-table';
	import type { ColumnDef, SortingState, PaginationState } from '@tanstack/svelte-table';
	import Fuse from 'fuse.js';

	interface ReliabilityEvent {
		id?: number;
		category: 'cron' | 'browser' | 'timezone' | 'general' | 'auth' | 'skill' | 'agent' | 'gateway';
		severity: 'critical' | 'high' | 'medium' | 'low';
		event: string;
		message: string;
		agentId?: string;
		sessionKey?: string;
		metadata?: Record<string, unknown>;
		timestamp: number;
	}

	let {
		events = [],
		title = ''
	}: {
		events: ReliabilityEvent[];
		title?: string;
	} = $props();

	// ── Fuzzy search ─────────────────────────────────────────────────────────
	let searchQuery = $state('');

	let filteredData = $derived.by(() => {
		if (!searchQuery.trim()) return events;
		const fuse = new Fuse(events, {
			keys: ['event', 'message', 'category', 'severity'],
			threshold: 0.4,
			ignoreLocation: true,
		});
		return fuse.search(searchQuery).map((r) => r.item);
	});

	// ── TanStack Table state ─────────────────────────────────────────────────
	const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

	let sorting = $state<SortingState>([{ id: 'timestamp', desc: true }]);
	let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 50 });

	// Reset to first page when search or source data changes
	$effect(() => {
		filteredData; // track dependency
		pagination = { pageSize: untrack(() => pagination.pageSize), pageIndex: 0 };
	});

	const columns: ColumnDef<ReliabilityEvent, any>[] = [
		{
			id: 'timestamp',
			accessorFn: (row) => row.timestamp,
			header: 'Time',
			size: 90,
			minSize: 70,
			sortingFn: 'basic',
		},
		{
			id: 'severity',
			accessorFn: (row) => row.severity,
			header: 'Severity',
			size: 90,
			minSize: 70,
			sortingFn: (a, b) =>
				(SEVERITY_ORDER[a.getValue('severity') as string] ?? 9) -
				(SEVERITY_ORDER[b.getValue('severity') as string] ?? 9),
		},
		{
			id: 'category',
			accessorKey: 'category',
			header: 'Category',
			size: 100,
			minSize: 80,
		},
		{
			id: 'event',
			accessorKey: 'event',
			header: 'Event',
			size: 220,
			minSize: 120,
		},
		{
			id: 'message',
			accessorKey: 'message',
			header: 'Message',
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

	// ── Expand state ─────────────────────────────────────────────────────────
	let expandedId = $state<string | null>(null);

	function getRowId(evt: ReliabilityEvent, i: number): string {
		return evt.id != null ? String(evt.id) : `${i}:${evt.timestamp}:${evt.event}`;
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	// ── Metadata helpers ─────────────────────────────────────────────────────
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
		return (meta != null && Object.keys(meta).length > 0) || !!evt.agentId || !!evt.sessionKey;
	}

	function formatMetaValue(
		key: string,
		value: unknown,
	): { text: string; style: 'plain' | 'pill' | 'code' | 'status-ok' | 'status-err' | 'duration' } {
		if (key === 'durationMs' && typeof value === 'number') {
			const text = value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
			return { text, style: 'duration' };
		}
		if (key === 'profileId' || key === 'provider') return { text: String(value), style: 'pill' };
		if (key === 'statusCode') {
			const code = Number(value);
			return { text: String(value), style: code >= 200 && code < 300 ? 'status-ok' : 'status-err' };
		}
		if (key === 'error' || key === 'jobId') return { text: String(value), style: 'code' };
		if (typeof value === 'object' && value !== null)
			return { text: JSON.stringify(value, null, 2), style: 'code' };
		return { text: String(value), style: 'plain' };
	}

	// ── Formatting helpers ───────────────────────────────────────────────────
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

	// ── Style maps ───────────────────────────────────────────────────────────
	const severityRowBorder: Record<string, string> = {
		critical: 'border-l-2 border-l-destructive',
		high: 'border-l-2 border-l-warning',
		medium: 'border-l-2 border-l-purple',
		low: 'border-l-2 border-l-muted-foreground/30',
	};

	const severityClasses: Record<string, string> = {
		critical: 'bg-destructive text-white',
		high: 'bg-warning text-black',
		medium: 'bg-purple text-white',
		low: 'bg-muted-foreground text-white',
	};

	const categoryClasses: Record<string, string> = {
		cron: 'bg-accent/15 text-accent border border-accent/30',
		browser: 'bg-warning/15 text-warning border border-warning/30',
		timezone: 'bg-purple/15 text-purple border border-purple/30',
		general: 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30',
		auth: 'bg-green-500/15 text-green-400 border border-green-500/30',
		skill: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
		agent: 'bg-pink-500/15 text-pink-400 border border-pink-500/30',
		gateway: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
	};

	// ── Pagination display helpers ───────────────────────────────────────────
	let totalRows = $derived(table.getFilteredRowModel().rows.length);
	let pageStart = $derived(pagination.pageIndex * pagination.pageSize + 1);
	let pageEnd = $derived(Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalRows));
	let canPrev = $derived(table.getCanPreviousPage());
	let canNext = $derived(table.getCanNextPage());
</script>

<div class="w-full rounded-lg overflow-hidden bg-card border border-border">
	<!-- Header: title + search + pagination controls -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20 flex-wrap gap-y-1.5">
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0"
			>{title || m.reliability_recentIncidents()}</span
		>

		<!-- Search input -->
		<div class="relative ml-2">
			<Search
				size={11}
				class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
			/>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search..."
				class="h-6 w-40 pl-6 pr-2 text-[11px] bg-bg3/60 border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent/50"
			/>
		</div>

		<div class="flex-1"></div>

		{#if events.length > 0}
			<!-- Page size picker -->
			<select
				bind:value={pagination.pageSize}
				onchange={() => (pagination = { ...pagination, pageIndex: 0 })}
				class="h-6 px-1.5 text-[11px] bg-bg3/60 border border-border rounded text-foreground cursor-pointer focus:outline-none focus:border-accent/50"
			>
				{#each PAGE_SIZE_OPTIONS as size (size)}
					<option value={size}>{size}</option>
				{/each}
			</select>

			<!-- Prev button -->
			<button
				type="button"
				class="flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:not-disabled:text-foreground hover:not-disabled:bg-border"
				disabled={!canPrev}
				onclick={() => table.previousPage()}
			>
				<ChevronLeft size={12} />
			</button>

			<!-- Range display -->
			<span class="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
				{#if totalRows > 0}
					{pageStart}–{pageEnd} of {totalRows}
				{:else}
					0 of 0
				{/if}
			</span>

			<!-- Next button -->
			<button
				type="button"
				class="flex items-center justify-center w-6 h-6 rounded border border-border text-muted-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default hover:not-disabled:text-foreground hover:not-disabled:bg-border"
				disabled={!canNext}
				onclick={() => table.nextPage()}
			>
				<ChevronRight size={12} />
			</button>
		{/if}
	</div>

	{#if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			{m.reliability_noIncidents()}
		</div>
	{:else if filteredData.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			No incidents matching "{searchQuery}"
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse">
				<thead>
					<tr class="bg-bg3/40 sticky top-0 z-[1]">
						<th class="w-7 py-2 px-0 border-b border-border"></th>
						{#each table.getHeaderGroups()[0].headers as header (header.id)}
							{@const sorted = header.column.getIsSorted()}
							{@const SortIcon = sorted === 'asc' ? ChevronUp : sorted === 'desc' ? ChevronDown : ChevronsUpDown}
							<th
								class="py-2 px-3 text-left border-b border-border cursor-pointer select-none hover:text-foreground transition-colors"
								style="width:{header.getSize()}px"
								onclick={header.column.getToggleSortingHandler()}
							>
								<span
									class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
								>
									{header.column.columnDef.header}
									<SortIcon
										size={10}
										class="shrink-0 {sorted ? 'text-accent' : 'opacity-40'}"
									/>
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
							class="border-b border-border/40 hover:bg-white/[0.025] {severityRowBorder[evt.severity] ?? ''} {expandable ? 'cursor-pointer' : ''}"
							onclick={() => expandable && toggleExpand(rowId)}
						>
							<td class="w-7 py-2 px-1 align-middle text-center">
								{#if expandable}
									<span
										class="inline-flex items-center justify-center transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
									>
										<ChevronRight size={12} class="text-muted-foreground" />
									</span>
								{/if}
							</td>
							<td
								class="py-2 px-3 text-xs text-muted-foreground tabular-nums cursor-default align-middle font-mono"
								style="width:{columns[0].size}px"
								title={formatFullDate(evt.timestamp)}
							>
								{formatRelativeTime(evt.timestamp)}
							</td>
							<td class="py-2 px-3 text-xs align-middle" style="width:{columns[1].size}px">
								<span
									class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md leading-snug whitespace-nowrap {severityClasses[evt.severity] ?? ''}"
									>{evt.severity}</span
								>
							</td>
							<td class="py-2 px-3 text-xs align-middle" style="width:{columns[2].size}px">
								<span
									class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md leading-snug whitespace-nowrap {categoryClasses[evt.category] ?? ''}"
									>{evt.category}</span
								>
							</td>
							<td
								class="py-2 px-3 text-xs text-foreground align-middle font-mono max-w-0 truncate"
								style="width:{columns[3].size}px"
								title={evt.event}
							>
								{evt.event}
							</td>
							<td
								class="py-2 px-3 text-xs text-muted-foreground align-middle max-w-0 truncate"
								title={evt.message}
							>
								{evt.message}
							</td>
						</tr>
						{#if isExpanded}
							<tr class="bg-bg3/30">
								<td colspan="6" class="py-3 px-4">
									<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
										{#if evt.agentId}
											<div class="flex items-center gap-2">
												<span class="text-muted-foreground font-medium">agentId:</span>
												<span class="text-foreground font-mono text-[11px]"
													>{evt.agentId}</span
												>
											</div>
										{/if}
										{#if evt.sessionKey}
											<div class="flex items-center gap-2">
												<span class="text-muted-foreground font-medium">sessionKey:</span>
												<span class="text-foreground font-mono text-[11px]"
													>{evt.sessionKey}</span
												>
											</div>
										{/if}
										{#if parseMetadata(evt.metadata)}
											{#each Object.entries(parseMetadata(evt.metadata)!) as [key, value] (key)}
												{@const formatted = formatMetaValue(key, value)}
												<div
													class="flex items-center gap-2 {formatted.style === 'code' && String(value).length > 60 ? 'col-span-2' : ''}"
												>
													<span class="text-muted-foreground font-medium">{key}:</span>
													{#if formatted.style === 'pill'}
														<span
															class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md bg-accent/15 text-accent border border-accent/30"
															>{formatted.text}</span
														>
													{:else if formatted.style === 'status-ok'}
														<span class="text-green-400 font-mono tabular-nums"
															>{formatted.text}</span
														>
													{:else if formatted.style === 'status-err'}
														<span class="text-destructive font-mono tabular-nums"
															>{formatted.text}</span
														>
													{:else if formatted.style === 'duration'}
														<span class="text-foreground font-mono tabular-nums"
															>{formatted.text}</span
														>
													{:else if formatted.style === 'code'}
														<code
															class="bg-bg3/60 text-foreground/80 px-1.5 py-0.5 rounded text-[11px] font-mono break-all"
															>{formatted.text}</code
														>
													{:else}
														<span class="text-foreground">{formatted.text}</span>
													{/if}
												</div>
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
</div>
