<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarClock } from 'lucide-svelte';
  import { PageHeader, Card, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import UtilizationHeatmap from '$lib/components/scheduling/UtilizationHeatmap.svelte';
  import RevenueByResource from '$lib/components/scheduling/RevenueByResource.svelte';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  const kpis = $derived([
    { id: 'k-upcoming', label: m.sched_kpi_upcoming(), value: data.summary.upcoming },
    { id: 'k-booked', label: m.sched_kpi_booked(), value: data.summary.bookedThisRange },
    { id: 'k-cancelled', label: m.sched_kpi_cancelled(), value: data.summary.cancelled },
    { id: 'k-noShow', label: m.sched_kpi_noShow(), value: data.summary.noShow },
    { id: 'k-staff', label: m.sched_kpi_staff(), value: data.summary.resourceCount },
    { id: 'k-eventTypes', label: m.sched_kpi_eventTypes(), value: data.summary.eventTypeCount },
  ]);
  const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

  const hasRevenue = $derived(data.revenue.some((r) => r.linkedRevenue > 0 || r.bookings > 0));

  // Same 12-col/56px grid as the other module dashboards (crm, finances): six
  // 2-wide KPI tiles on one row, full-width utilization + revenue cards below.
  const items = $derived([
    ...kpis.map((k) => ({ id: k.id, w: 2, h: 2 })),
    { id: 'utilization', w: 12, h: 4 },
    ...(hasRevenue ? [{ id: 'revenue', w: 12, h: 4 }] : []),
  ]);
</script>

<svelte:head><title>{m.nav_scheduling()}</title></svelte:head>

{#snippet cellBody(id: string)}
  {#if id.startsWith('k-')}
    {@const k = kpiById.get(id)}
    {#if k}
      <Card padding="md" class="h-full">
        <div class="t-caption">{k.label}</div>
        <div class="text-2xl font-semibold mt-1">{k.value}</div>
      </Card>
    {/if}
  {:else if id === 'utilization'}
    <Card padding="lg" class="h-full">
      <div class="mb-3">
        <h2 class="text-sm font-semibold">{m.sched_utilization_title()}</h2>
        <p class="t-caption">{m.sched_utilization_subtitle()}</p>
      </div>
      <UtilizationHeatmap utilization={data.utilization} />
    </Card>
  {:else if id === 'revenue'}
    <Card padding="lg" class="h-full">
      <div class="mb-3">
        <h2 class="text-sm font-semibold">{m.sched_revenue_title()}</h2>
        <p class="t-caption">{m.sched_revenue_subtitle()}</p>
      </div>
      <RevenueByResource revenue={data.revenue} />
    </Card>
  {/if}
{/snippet}

<PageShell
  archetype="dashboard"
  scroll="region"
  labelledBy="scheduling-dashboard-title"
  class="scheduling-dashboard-surface"
>
  <PageHeader
    titleId="scheduling-dashboard-title"
    title={m.nav_scheduling()}
    subtitle={m.sched_dashboard_subtitle()}
  >
    {#snippet leading()}
      <CalendarClock size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    {#if data.summary.resourceCount === 0}
      <EmptyState title={m.sched_empty_resources()}>
        {#snippet action()}
          <a href="/scheduling/resources" class="text-accent underline text-sm"
            >{m.sched_resource_new()}</a
          >
        {/snippet}
      </EmptyState>
    {:else}
      <EditableGrid
        id="scheduling-dashboard-v1"
        {items}
        cols={12}
        rowHeight={56}
        canSetDefault={isAdmin.value}
        readonly={!canAct('scheduling', 'edit')}
      >
        {#snippet cell(id)}{@render cellBody(id)}{/snippet}
      </EditableGrid>
    {/if}
  </PageBody>
</PageShell>
