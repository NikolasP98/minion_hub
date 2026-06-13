<script lang="ts">
	import type { ReliabilityEvent } from '$lib/state/reliability/reliability.svelte';
	import type { EChartsOption } from 'echarts';
	import ActivityLogTable from './ActivityLogTable.svelte';

	// Overview "Activity Log" — the full event taxonomy with the server-side
	// total/byCategory counts and a chart above the table. By default the chart is
	// the Event Timeline (passed in as `timelineOptions`); without it the table's
	// built-in severity scatter is used. Thin wrapper around ActivityLogTable.
	let {
		events = [],
		total,
		byCategory = {},
		timelineOptions,
		timelineHeight = '300px',
		onTimelineClick,
	}: {
		events: ReliabilityEvent[];
		total?: number;
		byCategory?: Record<string, number>;
		timelineOptions?: EChartsOption;
		timelineHeight?: string;
		onTimelineClick?: (params: unknown) => void;
	} = $props();

	// Raw event categories (the real taxonomy emitted by the gateway), used for the
	// drill-down tabs. Counts come from the server summary (`byCategory`).
	const CATEGORIES = [
		'all',
		'gateway',
		'agent',
		'tool',
		'message',
		'channel',
		'orchestration',
		'skill',
		'crash',
		'connection',
		'auth',
		'cron',
		'memory',
		'heartbeat',
	];
</script>

<ActivityLogTable
	{events}
	{total}
	{byCategory}
	categories={CATEGORIES}
	showTimeline
	{timelineOptions}
	{timelineHeight}
	{onTimelineClick}
/>
