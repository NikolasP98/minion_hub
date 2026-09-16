<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarPlus } from 'lucide-svelte';
  import { page } from '$app/state';
  import { goto } from '$lib/navigation';
  import { PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import AppointmentForm from '$lib/components/scheduling/AppointmentForm.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  // Prefill from a calendar empty-slot click (`?date=&time=&resourceId=`).
  const params = $derived(page.url.searchParams);
  // Reached with `?ticketId=&lineId=` (e.g. a future POS pending-scheduling
  // link) this books through the SAME single book-and-link endpoint the sell
  // page's schedule step uses (`POST /api/pos/tickets/:id/schedule`), so the
  // line's booking_id always gets stamped — the default `/api/scheduling/
  // bookings` this page otherwise posts to never touches pos_ticket_lines,
  // which is exactly the gap QA hit going through this page instead of
  // `/pos/sell?step=schedule&ticket=`.
  // TODO(handoff): nothing links here with these params yet — the
  // /pos/accounts client DETAIL DRAWER still has no pending-scheduling
  // section/link (the LIST row already does, see +page.svelte). See
  // proposals/2026-09-16-hub-pos-accounts-drawer-pending-scheduling.md.
  const ticketId = $derived(params.get('ticketId'));
  const lineId = $derived(params.get('lineId'));

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

  function localDay(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
</script>

<svelte:head><title>{m.appt_new_title()} · {m.nav_pos()}</title></svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="pos-appointment-new-title">
  <PageHeader
    titleId="pos-appointment-new-title"
    title={m.appt_new_title()}
    subtitle={m.appt_new_subtitle()}
  >
    {#snippet leading()}
      <CalendarPlus size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    <AppointmentForm
      eventTypes={data.eventTypes}
      resources={data.resources}
      stockEnabled={data.stockEnabled}
      initialDate={params.get('date')}
      initialTime={params.get('time')}
      initialResourceId={params.get('resourceId')}
      bookEndpoint={ticketId ? `/api/pos/tickets/${ticketId}/schedule` : undefined}
      bookPayload={ticketId && lineId ? { lineId } : undefined}
      onbooked={(booking) => toCalendar(localDay(booking.startTime))}
      oncancel={() => toCalendar()}
    />
  </PageBody>
</PageShell>
