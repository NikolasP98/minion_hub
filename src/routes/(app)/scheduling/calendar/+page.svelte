<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarDays } from 'lucide-svelte';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { fetchJson } from '$lib/api/fetch-json';
  import { toastError } from '$lib/state/ui';
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
    store.showInheritedTags = data.showInheritedTags;
  });

  async function onShowInheritedTagsChange(next: boolean) {
    const previous = store.showInheritedTags;
    store.showInheritedTags = next; // optimistic
    try {
      await fetchJson('/api/me/preferences/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { showInheritedTags: next } }),
      });
    } catch {
      store.showInheritedTags = previous;
      toastError(m.sched_cal_show_linked_tags_error());
    }
  }

  let calRef = $state<ReturnType<typeof SchedulingCalendar>>();
  let libraryTitle = $state('');

  // How many side-by-side lanes the current view draws: one per selected staff
  // member in `day` (resource columns), seven in `week`. `month`/`agenda` have
  // no time grid to squeeze, so they keep the container width.
  // Below `--cal-lane-min` per lane the day grid stops being readable — six
  // staff at 390px collapsed to 47px columns — so the schedule keeps its
  // minimum width and the body scrolls sideways instead of shrinking.
  const laneCount = $derived(
    data.view === 'day' ? data.staff.length || data.resources.length : data.view === 'week' ? 7 : 0,
  );
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
    showInheritedTags={store.showInheritedTags}
    {onShowInheritedTagsChange}
  />

  <PageBody padding="compact" scroll="region" class="cal-body">
    {#if data.resources.length === 0}
      <EmptyState title={m.sched_empty_resources()} />
    {:else}
      <div class="cal-lanes" style="--cal-lanes: {laneCount}">
        <SchedulingCalendar
          bind:this={calRef}
          {store}
          view={data.view}
          day={data.day}
          resources={data.resources}
          onTitleChange={(t) => (libraryTitle = t)}
        />
      </div>
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

  /* The schedule's own floor. The lanes never compress below `--cal-lane-min`;
     when they don't fit, `.cal-body` (scroll="region") scrolls in both axes and
     the document itself stays at the viewport width. */
  .cal-lanes {
    --cal-lane-min: 7.5rem;
    --cal-time-gutter: 5rem;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: calc(var(--cal-time-gutter) + var(--cal-lanes, 0) * var(--cal-lane-min));
  }
</style>
