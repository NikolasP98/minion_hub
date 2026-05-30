<script lang="ts">
	import type { ReliabilityEvent } from '$lib/state/reliability/reliability.svelte';
	import ActivityLogTable from './ActivityLogTable.svelte';

	// Overview "Activity Log" — the full event taxonomy with the severity-over-time
	// scatter timeline and server-side total/byCategory counts. Thin wrapper around
	// the shared ActivityLogTable (also reused by the Agents tab for an
	// agent-activity-only log).
	let {
		events = [],
		total,
		byCategory = {},
	}: {
		events: ReliabilityEvent[];
		total?: number;
		byCategory?: Record<string, number>;
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

<ActivityLogTable {events} {total} {byCategory} categories={CATEGORIES} showTimeline />
