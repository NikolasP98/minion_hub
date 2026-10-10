<script lang="ts">
  /**
   * HC-019 evidence: the four booking surfaces over ONE seeded custom value
   * (`?surface=table|board|list|drawer`, `?persona=allowed|restricted`).
   * Table/Board/drawer come from the ACTUAL `/scheduling/calendar` route
   * (the drawer opens from a Table row action); `list` mounts the ACTUAL
   * `BookingsView` (its own drawer opens from the card's detail action);
   * `drawer` mounts the drawer alone over a page-owned store, as the calendar
   * pages pass it. No server, no network, no production data.
   */
  import type { ComponentProps } from 'svelte';
  import Shell from './Shell.svelte';
  import CalendarPage from '../../../src/routes/(app)/scheduling/calendar/+page.svelte';
  import BookingsView from '$lib/components/scheduling/BookingsView.svelte';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import { createBookingCustomValues } from '$lib/components/scheduling/kit/booking-custom-values.svelte';
  import { calendarWindowScope } from '$lib/components/scheduling/calendar-window';
  import { installCustomFieldsFetch, personaFromLocation, SEEDED_EVENT } from './custom-fields';
  import {
    RESOURCES,
    KINDS,
    EVENT_TYPES,
    EVENTS,
    TAG_OPTIONS,
    FIXTURE_DAY,
    FIXTURE_TIME_ZONE,
  } from './seed';

  installCustomFieldsFetch(personaFromLocation());
  const params = new URLSearchParams(location.search);
  const surface = params.get('surface') ?? 'table';

  const calendarData = {
    view: 'day',
    pageView: surface === 'board' ? 'board' : 'table',
    day: FIXTURE_DAY,
    orgTz: FIXTURE_TIME_ZONE,
    calendarScope: calendarWindowScope('fixture-org', FIXTURE_TIME_ZONE),
    staff: [],
    kindId: null,
    showInheritedTags: true,
    resources: RESOURCES,
    kinds: KINDS,
    eventTypes: EVENT_TYPES,
    categories: [],
    hours: {},
    tagOptions: TAG_OPTIONS,
    bookings: EVENTS,
  } as unknown as ComponentProps<typeof CalendarPage>['data'];

  const listData = {
    orgTz: FIXTURE_TIME_ZONE,
    bookings: EVENTS.map((e) => ({
      id: e.id,
      status: e.status,
      startTime: e.start,
      eventTypeId: e.eventTypeId,
      resourceId: e.resourceId,
      attendeeName: e.attendeeName,
      attendeePhone: null,
    })),
    resources: RESOURCES,
    eventTypes: EVENT_TYPES.map((e) => ({ id: e.id, title: e.title, productId: e.productId })),
    stockEnabled: false,
    accrualSummaries: [],
  };

  // The standalone drawer surface: a page-owned store, as both calendar pages pass it.
  const drawerStore = createBookingCustomValues();
  void drawerStore.load();
</script>

<Shell>
  {#if surface === 'list'}
    <BookingsView
      data={listData}
      capabilities={{ createSalesOrder: false }}
      invalidateKey="fixture"
    />
  {:else if surface === 'drawer'}
    <BookingDetailDrawer
      bookingId={SEEDED_EVENT.id}
      customValues={drawerStore}
      timeZone={FIXTURE_TIME_ZONE}
      mutationScope="fixture"
      resources={RESOURCES}
      onclose={() => {}}
    />
  {:else}
    <CalendarPage data={calendarData} />
  {/if}
</Shell>
