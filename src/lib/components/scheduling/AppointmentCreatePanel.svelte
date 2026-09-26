<script lang="ts" module>
  export type AppointmentKind = 'appointment' | 'checkup';
</script>

<script lang="ts">
  /**
   * Everything the "book an appointment" surface needs AROUND `AppointmentForm`:
   * the appointment/checkup choice, the paid-treatment follow-up picker and the
   * "draw from package" selector. Lifted out of `/pos/appointments/new` so the
   * calendar's side tray and that route render ONE panel instead of two copies
   * (owner 2026-09-26: the new-appointment button opens the tray as a form).
   */
  import { Select, SegmentedControl } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import AppointmentForm, {
    type AppointmentEventType,
    type AppointmentResource,
    type CreatedBooking,
  } from '$lib/components/scheduling/AppointmentForm.svelte';
  import { drawableGrants } from '$lib/components/pos/drawable-grants';
  import { canAct } from '$lib/access/can.svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    eventTypes: AppointmentEventType[];
    resources: AppointmentResource[];
    /** Prefill from a calendar slot click. */
    initialDate?: string | null;
    initialTime?: string | null;
    initialResourceId?: string | null;
    /** Reached with a POS ticket line: books through the single book-and-link
     *  endpoint so the line's `booking_id` always gets stamped. */
    ticketId?: string | null;
    lineId?: string | null;
    /** Bindable so the host's heading can follow the choice. */
    kind?: AppointmentKind;
    onbooked: (booking: CreatedBooking) => void | Promise<void>;
    oncancel: () => void;
  }

  let {
    eventTypes,
    resources,
    initialDate = null,
    initialTime = null,
    initialResourceId = null,
    ticketId = null,
    lineId = null,
    kind = $bindable<AppointmentKind>('appointment'),
    onbooked,
    oncancel,
  }: Props = $props();

  const checkupMode = $derived(kind === 'checkup');

  // "Draw from package" — offered once the CustomerPicker inside AppointmentForm
  // (bound out via `bind:partyId`) resolves a client who holds active grants.
  type GrantRow = {
    grant: { id: string; serviceProductId: string; expiresAt: string | null };
    sessionsRemaining: number;
    status: string;
  };
  let partyId = $state<string | null>(null);
  let eventTypeId = $state('');
  /** The procedures after the lead one. Non-empty = this booking is a CONTAINER
   *  visit (owner 2026-09-26: "create an event with MULTIPLE procedures"). */
  let extraEventTypeIds = $state<string[]>([]);
  const multiPicked = $derived(extraEventTypeIds.length > 0);
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

  // A grant is issued for ONE service, so it has nothing to redeem against in a
  // multi-procedure visit (`createBookingGroup` would only ever draw it for the
  // lead member). Offered again the moment the visit is back to one procedure.
  const drawable = $derived(multiPicked ? [] : drawableGrants(grants));

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
  const followUp = $derived(
    checkupMode ? (treatments.find((t) => t.lineId === followPick) ?? null) : null,
  );
  // Picking a treatment preselects a product-less (free) service when one
  // exists and nothing was chosen yet — a checkup has no invoice of its own.
  $effect(() => {
    if (!followUp || eventTypeId) return;
    const free = eventTypes.find((e) => !e.productId);
    if (free) eventTypeId = free.id;
  });

  // Picking a grant preselects its service. Re-runs (harmlessly) whenever
  // `drawable` changes too, since the pick's own membership can change.
  $effect(() => {
    const id = grantPick;
    if (!id) return;
    const g = drawable.find((x) => x.grant.id === id);
    const et = g && eventTypes.find((e) => e.productId === g.grant.serviceProductId);
    if (et) eventTypeId = et.id;
  });

  const bookPayload = $derived(
    partyId
      ? {
          packageGrantId: (multiPicked ? '' : grantPick) || null,
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
    return eventTypes.find((e) => e.productId === serviceProductId)?.title ?? m.pos_pkg_line();
  }
</script>

<div class="appt-panel">
  {#if treatments.length}
    <!-- A checkup with nothing to follow up is meaningless, so the choice
       only exists once the picked customer has paid treatment history —
       hidden entirely (not disabled) until then, which is the same
       condition the picker below already gates on. -->
    <div class="kind-row">
      <span class="t-label">{m.appt_kind_label()}</span>
      <SegmentedControl
        aria-label={m.appt_kind_label()}
        bind:value={kind}
        items={[
          { value: 'appointment', label: m.appt_kind_appointment() },
          { value: 'checkup', label: m.appt_checkup_prefix() },
        ]}
      />
    </div>
  {/if}
  {#if checkupMode && treatments.length}
    <FormField label={m.appt_checkup_follow_label()}>
      {#snippet children(field)}
        <Select id={field.id} bind:value={followPick}>
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
  <!-- A ticket-linked booking stamps exactly ONE sold line, so that endpoint
     knows nothing about a multi-procedure visit — offer it everywhere else. -->
  <AppointmentForm
    {eventTypes}
    {resources}
    {initialDate}
    {initialTime}
    {initialResourceId}
    bind:eventTypeId
    bind:extraEventTypeIds
    multiService={!ticketId}
    bind:partyId
    bookEndpoint={ticketId ? `/api/pos/tickets/${ticketId}/schedule` : '/api/pos/appointments'}
    canBook={canAct('pos', 'create')}
    bookPayload={ticketId && lineId ? { lineId } : bookPayload}
    {onbooked}
    {oncancel}
  />
</div>

<style>
  .appt-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .kind-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
</style>
