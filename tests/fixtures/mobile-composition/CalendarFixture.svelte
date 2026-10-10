<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Shell from './Shell.svelte';
  // Mounts the ACTUAL scheduling calendar route component with synthetic data.
  import CalendarPage from '../../../src/routes/(app)/scheduling/calendar/+page.svelte';
  // Toast surface for the interactions spec's 409 case. Mounting the real
  // `<Toaster>` here raced the calendar's own effects in this standalone
  // (non-SvelteKit) mount, so the spec asserts on the store directly instead —
  // the same store `toastError`/`toastSuccess` both write into.
  import { toaster } from '$lib/state/ui/toast.svelte';
  import {
    RESOURCES,
    KINDS,
    EVENT_TYPES,
    EVENTS,
    TAG_OPTIONS,
    FIXTURE_DAY,
    FIXTURE_TIME_ZONE,
  } from './seed';
  import {
    calendarWindowScope,
    type CalendarView,
  } from '$lib/components/scheduling/calendar-window';

  (window as unknown as { __toaster: typeof toaster }).__toaster = toaster;

  const params = new URLSearchParams(location.search);
  const view = (params.get('view') ?? 'day') as CalendarView;
  const staffParam = params.get('staff');

  // The route's PageData also carries the whole (app) layout bundle; this
  // fixture only needs the page's own slice. `$state`, so a recorded `goto`
  // intent can be played back below exactly as the server load would resolve
  // it: `?view=table|board` changes the presentation and keeps the calendar's
  // own view; `?view=day|week|month|agenda` sets both; `?date=` moves the day.
  const data = $state({
    view,
    pageView: view,
    day: FIXTURE_DAY,
    orgTz: FIXTURE_TIME_ZONE,
    calendarScope: calendarWindowScope('fixture-org', FIXTURE_TIME_ZONE),
    staff: staffParam ? staffParam.split(',').filter(Boolean) : [],
    kindId: null,
    showInheritedTags: true,
    resources: params.get('resources') === '0' ? [] : RESOURCES,
    kinds: KINDS,
    eventTypes: EVENT_TYPES,
    categories: [],
    hours: {},
    tagOptions: TAG_OPTIONS,
    bookings: EVENTS,
  }) as unknown as ComponentProps<typeof CalendarPage>['data'];

  const CALENDAR_VIEWS = new Set(['day', 'week', 'month', 'agenda']);
  window.addEventListener('fixture:navigate', (e) => {
    const params = new URL((e as CustomEvent<string>).detail, location.href).searchParams;
    const next = params.get('view');
    const d = data as unknown as { view: string; pageView: string; day: string };
    if (next === 'table' || next === 'board') d.pageView = next;
    else if (next && CALENDAR_VIEWS.has(next)) d.pageView = d.view = next;
    const day = params.get('date');
    if (day) d.day = day;
  });
</script>

<Shell>
  <CalendarPage {data} />
</Shell>
