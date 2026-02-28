<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-svelte';

	interface ReliabilityEvent {
		category: 'cron' | 'browser' | 'timezone' | 'general';
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
		general: 'bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/30'
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
						{#each ([
							['timestamp', m.reliability_time(),     'w-[90px]'],
							['severity',  m.reliability_severity(), 'w-[90px]'],
							['category',  m.reliability_category(), 'w-[100px]'],
							['event',     m.reliability_event(),    'w-40'],
							['message',   m.reliability_message(),  'w-auto'],
						] as const) as [col, label, width]}
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
					{#each sortedEvents as evt (`${evt.timestamp}:${evt.event}:${evt.message}`)}
						<tr class="border-b border-border/40 hover:bg-white/[0.025] {severityRowBorder[evt.severity] ?? ''}">
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
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
