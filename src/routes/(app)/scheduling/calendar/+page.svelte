<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarDays } from 'lucide-svelte';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { CalendarStore } from '$lib/components/scheduling/calendar/calendar.svelte';
  import CalendarToolbar from '$lib/components/scheduling/calendar/CalendarToolbar.svelte';
  import SchedulingCalendar from '$lib/components/scheduling/calendar/SchedulingCalendar.svelte';

  let { data }: { data: PageData } = $props();

  const store = new CalendarStore();
  // Mirror props into the store on every load (view/date/staff/kind navigation
  // re-runs `load` — see PeopleView's `Timeline` for the same pattern). The
  // window covered by this page-load is merged as an already-"loaded" span, so
  // the calendar's own `ensure()` calls (from `datesSet`) only fetch what's
  // genuinely missing.
  $effect(() => {
    store.setKinds(data.kinds);
    store.mergeEvents(data.events, data.from, data.to);
    store.staff = new Set(data.staff);
    store.kindId = data.kindId;
  });

  let calRef = $state<ReturnType<typeof SchedulingCalendar>>();
  let libraryTitle = $state('');
</script>

<svelte:head><title>{m.sched_calendar_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-calendar-title"
  class="scheduling-calendar-surface"
>
  <PageHeader
    titleId="scheduling-calendar-title"
    title={m.sched_calendar_title()}
    subtitle={m.sched_calendar_subtitle()}
  >
    {#snippet leading()}
      <CalendarDays size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <CalendarToolbar
    view={data.view}
    day={data.day}
    resources={data.resources}
    kinds={data.kinds}
    staff={data.staff}
    kindId={data.kindId}
    title={libraryTitle}
    cal={calRef}
  />

  <PageBody padding="compact" scroll="none" class="cal-body">
    {#if data.resources.length === 0}
      <EmptyState title={m.sched_empty_resources()} />
    {:else}
      <SchedulingCalendar
        bind:this={calRef}
        {store}
        view={data.view}
        day={data.day}
        resources={data.resources}
        onTitleChange={(t) => (libraryTitle = t)}
      />
    {/if}
  </PageBody>
</PageShell>

<style>
  :global(.cal-body) {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
</style>
