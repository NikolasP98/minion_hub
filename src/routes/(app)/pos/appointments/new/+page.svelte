<script lang="ts">
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { CalendarPlus, Stethoscope } from 'lucide-svelte';
  import { page } from '$app/state';
  import { goto, invalidate } from '$lib/navigation';
  import { PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import type { CreatedBooking } from '$lib/components/scheduling/AppointmentForm.svelte';
  import AppointmentCreatePanel, {
    type AppointmentKind,
  } from '$lib/components/scheduling/AppointmentCreatePanel.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  // Prefill from a calendar empty-slot click (`?date=&time=&resourceId=`).
  const params = $derived(page.url.searchParams);
  // Reached with `?ticketId=&lineId=` (e.g. a future POS pending-scheduling
  // link) this books through the SAME single book-and-link endpoint the sell
  // page's schedule step uses (`POST /api/pos/tickets/:id/schedule`), so the
  // line's booking_id always gets stamped — the default `/api/pos/appointments`
  // the panel otherwise posts to never touches pos_ticket_lines, which is
  // exactly the gap QA hit going through this page instead of
  // `/pos/sell?step=schedule&ticket=`.
  // TODO(handoff): nothing links here with these params yet — the
  // /pos/accounts client DETAIL DRAWER still has no pending-scheduling
  // section/link (the LIST row already does, see +page.svelte). See
  // proposals/2026-09-16-hub-pos-accounts-drawer-pending-scheduling.md.
  const ticketId = $derived(params.get('ticketId'));
  const lineId = $derived(params.get('lineId'));
  /** This route STAYS for deep links and bookmarks (the ticket-linked flow, an
   *  emailed slot link); the calendar itself now opens the same panel in its
   *  side tray without navigating. `?mode=checkup` still pre-selects the
   *  checkup choice for old bookmarks. */
  let kind = $state<AppointmentKind>(
    untrack(() => params.get('mode') === 'checkup') ? 'checkup' : 'appointment',
  );

  /** Back to the calendar, focused on `day` when a booking was just created. */
  function toCalendar(day?: string) {
    const view = params.get('view');
    const query = new URLSearchParams();
    if (day) query.set('date', day);
    else if (params.get('date')) query.set('date', params.get('date')!);
    if (view) query.set('view', view);
    const qs = query.toString();
    return goto(qs ? `/pos/appointments?${qs}` : '/pos/appointments');
  }

  /** A successful book here can stamp a POS ticket line's booking_id (the
   *  `ticketId`/`lineId` path), which is exactly what the side-menu Accounts
   *  badge counts. `goto` back to the calendar does NOT rerun the shared
   *  `/pos` layout load, so without this the badge stays stale until a hard
   *  refresh — see `/pos/+layout.server.ts` `depends('pos:pending')`. */
  async function onBooked(booking: CreatedBooking) {
    await invalidate('pos:pending');
    await toCalendar(localDay(booking.startTime));
  }

  function localDay(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
</script>

<svelte:head>
  <title>{kind === 'checkup' ? m.appt_checkup_title() : m.appt_new_title()} · {m.nav_pos()}</title>
</svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="pos-appointment-new-title">
  <PageHeader
    titleId="pos-appointment-new-title"
    title={kind === 'checkup' ? m.appt_checkup_title() : m.appt_new_title()}
    subtitle={kind === 'checkup' ? m.appt_checkup_subtitle() : m.appt_new_subtitle()}
  >
    {#snippet leading()}
      {#if kind === 'checkup'}
        <Stethoscope size={iconSizes.md} class="text-accent shrink-0" />
      {:else}
        <CalendarPlus size={iconSizes.md} class="text-accent shrink-0" />
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    <AppointmentCreatePanel
      eventTypes={data.eventTypes}
      resources={data.resources}
      initialDate={params.get('date')}
      initialTime={params.get('time')}
      initialResourceId={params.get('resourceId')}
      {ticketId}
      {lineId}
      bind:kind
      onbooked={onBooked}
      oncancel={() => toCalendar()}
    />
  </PageBody>
</PageShell>
