<script lang="ts">
	import type { PageData } from './$types';
	import { CalendarClock } from 'lucide-svelte';
	import { PageHeader, Card, EmptyState } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import UtilizationHeatmap from '$lib/components/scheduling/UtilizationHeatmap.svelte';
	import RevenueByResource from '$lib/components/scheduling/RevenueByResource.svelte';

	let { data }: { data: PageData } = $props();

	const kpis = $derived([
		{ label: m.sched_kpi_upcoming(), value: data.summary.upcoming },
		{ label: m.sched_kpi_booked(), value: data.summary.bookedThisRange },
		{ label: m.sched_kpi_cancelled(), value: data.summary.cancelled },
		{ label: m.sched_kpi_noShow(), value: data.summary.noShow },
		{ label: m.sched_kpi_staff(), value: data.summary.resourceCount },
		{ label: m.sched_kpi_eventTypes(), value: data.summary.eventTypeCount },
	]);

	const hasRevenue = $derived(data.revenue.some((r) => r.linkedRevenue > 0 || r.bookings > 0));
</script>

<svelte:head><title>{m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_scheduling()} subtitle={m.sched_dashboard_subtitle()}>
		{#snippet leading()}
			<CalendarClock size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		<!-- KPI row -->
		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
			{#each kpis as kpi (kpi.label)}
				<Card padding="md">
					<div class="t-caption">{kpi.label}</div>
					<div class="text-2xl font-semibold mt-1">{kpi.value}</div>
				</Card>
			{/each}
		</div>

		{#if data.summary.resourceCount === 0}
			<EmptyState title={m.sched_empty_resources()}>
				{#snippet action()}
					<a href="/scheduling/resources" class="text-accent underline text-sm">{m.sched_resource_new()}</a>
				{/snippet}
			</EmptyState>
		{:else}
			<!-- Utilization heatmap -->
			<Card padding="lg">
				<div class="mb-3">
					<h2 class="text-sm font-semibold">{m.sched_utilization_title()}</h2>
					<p class="t-caption">{m.sched_utilization_subtitle()}</p>
				</div>
				<UtilizationHeatmap utilization={data.utilization} />
			</Card>

			<!-- Revenue overlay -->
			{#if hasRevenue}
				<Card padding="lg">
					<div class="mb-3">
						<h2 class="text-sm font-semibold">{m.sched_revenue_title()}</h2>
						<p class="t-caption">{m.sched_revenue_subtitle()}</p>
					</div>
					<RevenueByResource revenue={data.revenue} />
				</Card>
			{/if}
		{/if}
	</div>
</div>
