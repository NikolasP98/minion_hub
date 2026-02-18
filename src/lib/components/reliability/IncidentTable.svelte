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
</script>

<div class="incident-table-wrapper">
	<h3 class="table-title">{title}</h3>

	{#if events.length === 0}
		<div class="empty-state">No incidents</div>
	{:else}
		<div class="table-scroll">
			<table>
				<thead>
					<tr>
						<th class="col-time" onclick={() => toggleSort('timestamp')}>
							Time{getSortIndicator('timestamp')}
						</th>
						<th class="col-severity" onclick={() => toggleSort('severity')}>
							Severity{getSortIndicator('severity')}
						</th>
						<th class="col-category" onclick={() => toggleSort('category')}>
							Category{getSortIndicator('category')}
						</th>
						<th class="col-event" onclick={() => toggleSort('event')}>
							Event{getSortIndicator('event')}
						</th>
						<th class="col-message" onclick={() => toggleSort('message')}>
							Message{getSortIndicator('message')}
						</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedEvents as evt (evt.timestamp + evt.event + evt.message)}
						<tr>
							<td class="col-time" title={formatFullDate(evt.timestamp)}>
								{formatRelativeTime(evt.timestamp)}
							</td>
							<td class="col-severity">
								<span class="badge severity-{evt.severity}">{evt.severity}</span>
							</td>
							<td class="col-category">
								<span class="badge category-{evt.category}">{evt.category}</span>
							</td>
							<td class="col-event">{evt.event}</td>
							<td class="col-message">
								<span class="message-text" title={evt.message}>{evt.message}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.incident-table-wrapper {
		width: 100%;
		border-radius: var(--radius, 10px);
		overflow: hidden;
		background: var(--card, #151d2e);
		border: 1px solid var(--border, #2a3548);
	}

	.table-title {
		margin: 0;
		padding: 12px 16px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text, #e2e8f0);
		border-bottom: 1px solid var(--border, #2a3548);
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 16px;
		color: var(--text3, #64748b);
		font-size: 13px;
	}

	.table-scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	thead tr {
		background: var(--bg3, #1e293b);
		position: sticky;
		top: 0;
		z-index: 1;
	}

	th {
		padding: 8px 12px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text3, #64748b);
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
		border-bottom: 1px solid var(--border, #2a3548);
	}

	th:hover {
		color: var(--text2, #94a3b8);
	}

	tbody tr {
		background: transparent;
		border-bottom: 1px solid rgba(42, 53, 72, 0.5);
	}

	tbody tr:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	td {
		padding: 8px 12px;
		font-size: 12px;
		color: var(--text, #e2e8f0);
		vertical-align: middle;
	}

	.col-time {
		width: 90px;
	}

	.col-severity {
		width: 90px;
	}

	.col-category {
		width: 100px;
	}

	.col-event {
		width: 160px;
	}

	.col-message {
		width: auto;
	}

	td.col-time {
		color: var(--text2, #94a3b8);
		font-variant-numeric: tabular-nums;
		cursor: default;
	}

	.badge {
		display: inline-block;
		font-size: 10px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 10px;
		line-height: 1.4;
		white-space: nowrap;
	}

	.severity-critical {
		background: var(--red, #ef4444);
		color: #fff;
	}

	.severity-high {
		background: var(--amber, #f59e0b);
		color: #000;
	}

	.severity-medium {
		background: var(--purple, #a855f7);
		color: #fff;
	}

	.severity-low {
		background: var(--text3, #64748b);
		color: #fff;
	}

	.category-cron {
		background: rgba(99, 102, 241, 0.2);
		color: var(--accent, #6366f1);
		border: 1px solid rgba(99, 102, 241, 0.3);
	}

	.category-browser {
		background: rgba(245, 158, 11, 0.15);
		color: var(--amber, #f59e0b);
		border: 1px solid rgba(245, 158, 11, 0.3);
	}

	.category-timezone {
		background: rgba(168, 85, 247, 0.15);
		color: var(--purple, #a855f7);
		border: 1px solid rgba(168, 85, 247, 0.3);
	}

	.category-general {
		background: rgba(100, 116, 139, 0.2);
		color: var(--text3, #64748b);
		border: 1px solid rgba(100, 116, 139, 0.3);
	}

	.message-text {
		display: inline-block;
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: middle;
	}
</style>
