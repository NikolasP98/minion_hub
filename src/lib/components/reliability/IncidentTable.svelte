<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from 'lucide-svelte';

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

	type SortColumn = 'timestamp' | 'severity' | 'category' | 'event' | 'message';
	type SortDirection = 'asc' | 'desc';

	const SEVERITY_ORDER: Record<string, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3
	};

	let {
		events = [],
		maxRows = 50,
		title = ''
	}: {
		events: ReliabilityEvent[];
		maxRows?: number;
		title?: string;
	} = $props();

	let sortColumn: SortColumn = $state('timestamp');
	let sortDirection: SortDirection = $state('desc');
	let expandedId = $state<string | null>(null);

	function parseMetadata(raw: unknown): Record<string, unknown> | null {
		if (raw == null) return null;
		if (typeof raw === 'string') {
			try { return JSON.parse(raw); } catch { return null; }
		}
		if (typeof raw === 'object') return raw as Record<string, unknown>;
		return null;
	}

	function hasMetadata(evt: ReliabilityEvent): boolean {
		const meta = parseMetadata(evt.metadata);
		return (meta != null && Object.keys(meta).length > 0) ||
			!!evt.agentId || !!evt.sessionKey;
	}

	function getRowId(evt: ReliabilityEvent, i: number): string {
		return evt.id != null ? String(evt.id) : `${i}:${evt.timestamp}:${evt.event}`;
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function formatMetaValue(key: string, value: unknown): { text: string; style: 'plain' | 'pill' | 'code' | 'status-ok' | 'status-err' | 'duration' } {
		if (key === 'durationMs' && typeof value === 'number') {
			const text = value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
			return { text, style: 'duration' };
		}
		if (key === 'profileId' || key === 'provider') {
			return { text: String(value), style: 'pill' };
		}
		if (key === 'statusCode') {
			const code = Number(value);
			const style = code >= 200 && code < 300 ? 'status-ok' as const : 'status-err' as const;
			return { text: String(value), style };
		}
		if (key === 'error') {
			return { text: String(value), style: 'code' };
		}
		if (key === 'jobId') {
			return { text: String(value), style: 'code' };
		}
		if (typeof value === 'object' && value !== null) {
			return { text: JSON.stringify(value, null, 2), style: 'code' };
		}
		return { text: String(value), style: 'plain' };
	}

	function toggleSort(column: SortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = column === 'timestamp' ? 'desc' : 'asc';
		}
	}

	let sortedEvents = $derived.by(() => {
		const sorted = [...events].sort((a, b) => {
			let cmp = 0;
			switch (sortColumn) {
				case 'timestamp':
					cmp = a.timestamp - b.timestamp;
					break;
				case 'severity':
					cmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
					break;
				case 'category':
					cmp = a.category.localeCompare(b.category);
					break;
				case 'event':
					cmp = a.event.localeCompare(b.event);
					break;
				case 'message':
					cmp = a.message.localeCompare(b.message);
					break;
			}
			return sortDirection === 'asc' ? cmp : -cmp;
		});
		return sorted.slice(0, maxRows);
	});

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
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

	function getSortIcon(column: SortColumn): typeof ChevronUp {
		if (sortColumn !== column) return ChevronsUpDown;
		return sortDirection === 'asc' ? ChevronUp : ChevronDown;
	}

	const severityRowBorder: Record<string, string> = {
		critical: 'border-l-2 border-l-destructive',
		high:     'border-l-2 border-l-warning',
		medium:   'border-l-2 border-l-purple',
		low:      'border-l-2 border-l-muted-foreground/30'
	};

	const severityClasses: Record<string, string> = {
		critical: 'bg-destructive text-white',
		high: 'bg-warning text-black',
		medium: 'bg-purple text-white',
		low: 'bg-muted-foreground text-white'
	};

	const categoryClasses: Record<string, string> = {
		cron: 'bg-accent/15 text-accent border border-accent/30',
		browser: 'bg-warning/15 text-warning border border-warning/30',
		timezone: 'bg-purple/15 text-purple border border-purple/30',
		general: 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30',
		auth: 'bg-green-500/15 text-green-400 border border-green-500/30',
		skill: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
		agent: 'bg-pink-500/15 text-pink-400 border border-pink-500/30',
		gateway: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
	};
</script>

<div class="w-full rounded-lg overflow-hidden bg-card border border-border">
	<!-- Widget-style header -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{title || m.reliability_recentIncidents()}</span>
		{#if events.length > 0}
			<span class="text-[10px] text-muted-foreground/60 tabular-nums">{sortedEvents.length} / {events.length}</span>
		{/if}
	</div>

	{#if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noIncidents()}</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse table-fixed">
				<thead>
					<tr class="bg-bg3/40 sticky top-0 z-[1]">
						<th class="w-7 py-2 px-0 border-b border-border"></th>
						{#each ([
							['timestamp', m.reliability_time(),     'w-[90px]'],
							['severity',  m.reliability_severity(), 'w-[90px]'],
							['category',  m.reliability_category(), 'w-[100px]'],
							['event',     m.reliability_event(),    'w-40'],
							['message',   m.reliability_message(),  'w-auto'],
						] as const) as [col, label, width] (col)}
							{@const SortIcon = getSortIcon(col as SortColumn)}
							<th
								class="{width} py-2 px-3 text-left border-b border-border cursor-pointer select-none hover:text-foreground transition-colors"
								onclick={() => toggleSort(col as SortColumn)}
							>
								<span class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
									{label}
									<SortIcon size={10} class="shrink-0 {sortColumn === col ? 'text-accent' : 'opacity-40'}" />
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sortedEvents as evt, i (evt.id ?? `${i}:${evt.timestamp}:${evt.event}`)}
						{@const rowId = getRowId(evt, i)}
						{@const isExpanded = expandedId === rowId}
						{@const expandable = hasMetadata(evt)}
						<tr
							class="border-b border-border/40 hover:bg-white/[0.025] {severityRowBorder[evt.severity] ?? ''} {expandable ? 'cursor-pointer' : ''}"
							onclick={() => expandable && toggleExpand(rowId)}
						>
							<td class="w-7 py-2 px-1 align-middle text-center">
								{#if expandable}
									<span class="inline-flex items-center justify-center transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}">
										<ChevronRight size={12} class="text-muted-foreground" />
									</span>
								{/if}
							</td>
							<td class="w-[90px] py-2 px-3 text-xs text-muted-foreground tabular-nums cursor-default align-middle font-mono" title={formatFullDate(evt.timestamp)}>
								{formatRelativeTime(evt.timestamp)}
							</td>
							<td class="w-[90px] py-2 px-3 text-xs align-middle">
								<span class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md leading-snug whitespace-nowrap {severityClasses[evt.severity] ?? ''}">{evt.severity}</span>
							</td>
							<td class="w-[100px] py-2 px-3 text-xs align-middle">
								<span class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md leading-snug whitespace-nowrap {categoryClasses[evt.category] ?? ''}">{evt.category}</span>
							</td>
							<td class="w-40 py-2 px-3 text-xs text-foreground align-middle font-mono">{evt.event}</td>
							<td class="w-auto py-2 px-3 text-xs text-muted-foreground align-middle">
								<span class="inline-block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap align-middle" title={evt.message}>{evt.message}</span>
							</td>
						</tr>
						{#if isExpanded}
							<tr class="bg-bg3/30">
								<td colspan="6" class="py-3 px-4">
									<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
										{#if evt.agentId}
											<div class="flex items-center gap-2">
												<span class="text-muted-foreground font-medium">agentId:</span>
												<span class="text-foreground font-mono text-[11px]">{evt.agentId}</span>
											</div>
										{/if}
										{#if evt.sessionKey}
											<div class="flex items-center gap-2">
												<span class="text-muted-foreground font-medium">sessionKey:</span>
												<span class="text-foreground font-mono text-[11px]">{evt.sessionKey}</span>
											</div>
										{/if}
										{#if parseMetadata(evt.metadata)}
											{#each Object.entries(parseMetadata(evt.metadata)!) as [key, value] (key)}
												{@const formatted = formatMetaValue(key, value)}
												<div class="flex items-center gap-2 {formatted.style === 'code' && String(value).length > 60 ? 'col-span-2' : ''}">
													<span class="text-muted-foreground font-medium">{key}:</span>
													{#if formatted.style === 'pill'}
														<span class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-md bg-accent/15 text-accent border border-accent/30">{formatted.text}</span>
													{:else if formatted.style === 'status-ok'}
														<span class="text-green-400 font-mono tabular-nums">{formatted.text}</span>
													{:else if formatted.style === 'status-err'}
														<span class="text-destructive font-mono tabular-nums">{formatted.text}</span>
													{:else if formatted.style === 'duration'}
														<span class="text-foreground font-mono tabular-nums">{formatted.text}</span>
													{:else if formatted.style === 'code'}
														<code class="bg-bg3/60 text-foreground/80 px-1.5 py-0.5 rounded text-[11px] font-mono break-all">{formatted.text}</code>
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
