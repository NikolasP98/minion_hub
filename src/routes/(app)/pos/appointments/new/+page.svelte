<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarPlus, Stethoscope } from 'lucide-svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import { page } from '$app/state';
  import { goto, invalidate } from '$lib/navigation';
  import { PageHeader, Select, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell, FormField } from '$lib/components/ui/foundations';
  import AppointmentForm, {
    type CreatedBooking,
  } from '$lib/components/scheduling/AppointmentForm.svelte';
  import { drawableGrants } from '$lib/components/pos/drawable-grants';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

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
  /** `?mode=checkup`: a free follow-up that references one of the customer's
   *  paid treatments (picked from their history below). Same form otherwise. */
  const checkupMode = $derived(params.get('mode') === 'checkup');

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

  // "Draw from package" — offered once the CustomerPicker inside AppointmentForm
  // (bound out via `bind:partyId`) resolves a client who holds active grants.
  type GrantRow = {
    grant: { id: string; serviceProductId: string; expiresAt: string | null };
    sessionsRemaining: number;
    status: string;
  };
  let partyId = $state<string | null>(null);
  let eventTypeId = $state('');
  let grants = $state<GrantRow[]>([]);
  let grantPick = $state('');
  let grantsGen = 0;

  $effect(() => {
    const pid = partyId;
    grantPick = '';
    grants = [];
    if (!pid) return;
    const token = ++grantsGen;
    fetch(`/api/pos/packages/grants?partyId=${encodeURIComponent(pid)}`)
      .then((r) => (r.ok ? r.json() : { grants: [] }))
      .then((j: { grants?: GrantRow[] }) => {
        if (token === grantsGen) grants = j.grants ?? [];
      })
      .catch(() => {
        if (token === grantsGen) grants = [];
      });
  });

  const drawable = $derived(drawableGrants(grants));

  // ── Paid treatment history (a checkup follows one of these) ──
  type Treatment = {
    lineId: string;
    ticketId: string;
    ticketHumanId: string | null;
    submittedAt: string;
    description: string;
    finProductId: string | null;
    total: string;
    bookingId: string | null;
    bookingStart: string | null;
  };
  let treatments = $state<Treatment[]>([]);
  let followPick = $state('');
  let treatmentsGen = 0;
  $effect(() => {
    const pid = partyId;
    followPick = '';
    treatments = [];
    if (!pid) return;
    const token = ++treatmentsGen;
    fetch(`/api/pos/treatments?partyId=${encodeURIComponent(pid)}`)
      .then((r) => (r.ok ? r.json() : { treatments: [] }))
      .then((j: { treatments?: Treatment[] }) => {
        if (token === treatmentsGen) treatments = j.treatments ?? [];
      })
      .catch(() => {
        if (token === treatmentsGen) treatments = [];
      });
  });
  const followUp = $derived(treatments.find((t) => t.lineId === followPick) ?? null);
  // Picking a treatment preselects a product-less (free) service when one
  // exists and nothing was chosen yet — a checkup has no invoice of its own.
  $effect(() => {
    if (!followUp || eventTypeId) return;
    const free = data.eventTypes.find((e) => !e.productId);
    if (free) eventTypeId = free.id;
  });

  // Picking a grant preselects its service. Re-runs (harmlessly) whenever
  // `drawable` changes too, since the pick's own membership can change.
  $effect(() => {
    const id = grantPick;
    if (!id) return;
    const g = drawable.find((x) => x.grant.id === id);
    const et = g && data.eventTypes.find((e) => e.productId === g.grant.serviceProductId);
    if (et) eventTypeId = et.id;
  });

  const bookPayload = $derived(
    partyId
      ? {
          packageGrantId: grantPick || null,
          partyId,
          ...(followUp
            ? {
                title: `${m.appt_checkup_prefix()} · ${followUp.description}`,
                metadata: {
                  followUpOf: {
                    ticketId: followUp.ticketId,
                    lineId: followUp.lineId,
                    productId: followUp.finProductId,
                    description: followUp.description,
                    at: followUp.submittedAt,
                  },
                },
              }
            : {}),
        }
      : undefined,
  );

  function serviceNameOf(serviceProductId: string): string {
    return data.eventTypes.find((e) => e.productId === serviceProductId)?.title ?? m.pos_pkg_line();
  }
</script>

<svelte:head>
  <title>{checkupMode ? m.appt_checkup_title() : m.appt_new_title()} · {m.nav_pos()}</title>
</svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="pos-appointment-new-title">
  <PageHeader
    titleId="pos-appointment-new-title"
    title={checkupMode ? m.appt_checkup_title() : m.appt_new_title()}
    subtitle={checkupMode ? m.appt_checkup_subtitle() : m.appt_new_subtitle()}
  >
    {#snippet leading()}
      {#if checkupMode}
        <Stethoscope size={iconSizes.md} class="text-accent shrink-0" />
      {:else}
        <CalendarPlus size={iconSizes.md} class="text-accent shrink-0" />
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    {#if treatments.length || (checkupMode && partyId)}
      <FormField
        label={m.appt_checkup_follow_label()}
        helper={treatments.length ? undefined : m.appt_checkup_none()}
      >
        {#snippet children(field)}
          <Select id={field.id} bind:value={followPick} disabled={treatments.length === 0}>
            <option value="">{m.appt_checkup_follow_pick()}</option>
            {#each treatments as t (t.lineId)}
              <option value={t.lineId}>
                {t.description} — {formatMoney(t.total)} · {formatDate(t.submittedAt, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </option>
            {/each}
          </Select>
        {/snippet}
      </FormField>
    {/if}
    {#if drawable.length}
      <FormField label={m.appt_new_draw_from_package()}>
        {#snippet children(field)}
          <Select id={field.id} bind:value={grantPick}>
            <option value="">{m.appt_new_draw_pick()}</option>
            {#each drawable as g (g.grant.id)}
              <option value={g.grant.id}>
                {serviceNameOf(g.grant.serviceProductId)} —
                {m.pos_pkg_sessions_left({ remaining: String(g.sessionsRemaining) })}
                {g.grant.expiresAt ? `· ${m.pos_pkg_expires({ date: g.grant.expiresAt })}` : ''}
              </option>
            {/each}
          </Select>
        {/snippet}
      </FormField>
    {/if}
    <AppointmentForm
      eventTypes={data.eventTypes}
      resources={data.resources}
      initialDate={params.get('date')}
      initialTime={params.get('time')}
      initialResourceId={params.get('resourceId')}
      bind:eventTypeId
      bind:partyId
      bookEndpoint={ticketId ? `/api/pos/tickets/${ticketId}/schedule` : '/api/pos/appointments'}
      canBook={canAct('pos', 'create')}
      bookPayload={ticketId && lineId ? { lineId } : bookPayload}
      onbooked={onBooked}
      oncancel={() => toCalendar()}
    />
  </PageBody>
</PageShell>
