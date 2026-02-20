<script lang="ts">
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
		title = 'Recent Incidents'
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

	function getSortIndicator(column: SortColumn): string {
		if (sortColumn !== column) return '';
		return sortDirection === 'asc' ? ' \u25B2' : ' \u25BC';
	}

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
	<h3 class="m-0 py-3 px-4 text-[13px] font-semibold text-foreground border-b border-border">{title}</h3>

	{#if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">No incidents</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse table-fixed">
				<thead>
					<tr class="bg-bg3 sticky top-0 z-[1]">
						<th class="w-[90px] py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left whitespace-nowrap cursor-pointer select-none border-b border-border hover:text-muted" onclick={() => toggleSort('timestamp')}>
							Time{getSortIndicator('timestamp')}
						</th>
						<th class="w-[90px] py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left whitespace-nowrap cursor-pointer select-none border-b border-border hover:text-muted" onclick={() => toggleSort('severity')}>
							Severity{getSortIndicator('severity')}
						</th>
						<th class="w-[100px] py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left whitespace-nowrap cursor-pointer select-none border-b border-border hover:text-muted" onclick={() => toggleSort('category')}>
							Category{getSortIndicator('category')}
						</th>
						<th class="w-40 py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left whitespace-nowrap cursor-pointer select-none border-b border-border hover:text-muted" onclick={() => toggleSort('event')}>
							Event{getSortIndicator('event')}
						</th>
						<th class="w-auto py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left whitespace-nowrap cursor-pointer select-none border-b border-border hover:text-muted" onclick={() => toggleSort('message')}>
							Message{getSortIndicator('message')}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedEvents as evt (evt.timestamp + evt.event + evt.message)}
						<tr class="border-b border-border/50 hover:bg-white/[0.02]">
							<td class="w-[90px] py-2 px-3 text-xs text-muted tabular-nums cursor-default align-middle" title={formatFullDate(evt.timestamp)}>
								{formatRelativeTime(evt.timestamp)}
							</td>
							<td class="w-[90px] py-2 px-3 text-xs text-foreground align-middle">
								<span class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-lg leading-snug whitespace-nowrap {severityClasses[evt.severity] ?? ''}">{evt.severity}</span>
							</td>
							<td class="w-[100px] py-2 px-3 text-xs text-foreground align-middle">
								<span class="inline-block text-[10px] font-semibold py-0.5 px-2 rounded-lg leading-snug whitespace-nowrap {categoryClasses[evt.category] ?? ''}">{evt.category}</span>
							</td>
							<td class="w-40 py-2 px-3 text-xs text-foreground align-middle">{evt.event}</td>
							<td class="w-auto py-2 px-3 text-xs text-foreground align-middle">
								<span class="inline-block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap align-middle" title={evt.message}>{evt.message}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
