<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Shell from './Shell.svelte';
  // Mounts the ACTUAL scheduling calendar route component with synthetic data.
  import CalendarPage from '../../../src/routes/(app)/scheduling/calendar/+page.svelte';
  // Toast surface for the interactions spec's 409 case. Mounting the real
  // `<Toaster>` here races SchedulingCalendar's own resource/event effects
  // in this standalone (non-SvelteKit) mount and blanks the resource grid —
  // reproduced with nothing but `<Toaster>` present, unrelated to anything
  // this slice owns (event-calendar's `options` diffing vs. zag's machine
  // init). The store itself needs no rendering to be readable, so expose it
  // for the spec to assert on directly instead (`toaster.getVisibleToasts()`),
  // the same store `toastError`/`toastSuccess` both write into.
  import { toaster } from '$lib/state/ui/toast.svelte';
  import { RESOURCES, KINDS, EVENTS, FROM, TO, FIXTURE_DAY } from './seed';
  import type { CalendarView } from '$lib/components/scheduling/calendar/types';

  (window as unknown as { __toaster: typeof toaster }).__toaster = toaster;

  const params = new URLSearchParams(location.search);
  const view = (params.get('view') ?? 'day') as CalendarView;
  const staffParam = params.get('staff');

  // The route's PageData also carries the whole (app) layout bundle; this
  // fixture only needs the page's own slice.
  const data = {
    view,
    day: FIXTURE_DAY,
    staff: staffParam ? staffParam.split(',').filter(Boolean) : [],
    kindId: null,
    showInheritedTags: true,
    resources: params.get('resources') === '0' ? [] : RESOURCES,
    kinds: KINDS,
    tags: [],
    from: FROM,
    to: TO,
    events: EVENTS,
  } as unknown as ComponentProps<typeof CalendarPage>['data'];
</script>

<Shell>
  <CalendarPage {data} />
</Shell>
