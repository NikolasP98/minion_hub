<script lang="ts" module>
  /** What the calendar asks the tray to open with. */
  export type BookingCreateTarget = {
    day: string;
    /** Snapped `HH:MM` from a day/week grid click; absent for a plain "new". */
    time?: string | null;
    /** Day-view resource column the click landed on. */
    resourceId?: string | null;
    /** Paid-but-unscheduled POS line being scheduled (book-and-link endpoint). */
    ticketId?: string | null;
    lineId?: string | null;
    /** Customer + service already settled by the sold line (drop/pick
     *  fallback) — the form opens on the slot grid instead of re-asking. */
    partyId?: string | null;
    customerName?: string | null;
    eventTypeId?: string | null;
  };
</script>

<script lang="ts">
  /**
   * The create side tray (owner 2026-09-26: "instead of opening a whole new
   * page, make it so that it opens the known tray menu on the side as a FORM").
   * Same `Sheet` shell as `BookingDetailDrawer` — native `<dialog showModal>`,
   * so backdrop/Escape dismissal and the top-layer stacking every floating
   * panel inside it relies on are the primitive's, not hand-rolled.
   */
  import { Sheet } from '$lib/components/ui/foundations';
  import AppointmentCreatePanel, { type AppointmentKind } from './AppointmentCreatePanel.svelte';
  import type {
    AppointmentEventType,
    AppointmentResource,
    CreatedBooking,
  } from './AppointmentForm.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    target,
    eventTypes,
    resources,
    timeZone,
    mutationScope,
    bookEndpoint,
    canBook,
    onclose,
    onbooked,
  }: {
    /** `null` = closed. Every field of a fresh target seeds a fresh panel. */
    target: BookingCreateTarget | null;
    eventTypes: AppointmentEventType[];
    resources: AppointmentResource[];
    timeZone: string;
    mutationScope: string;
    /** Booking endpoint + its capability gate — forwarded to
     *  `AppointmentCreatePanel`, which defaults both to the POS pair. */
    bookEndpoint?: string;
    canBook?: boolean;
    onclose: () => void;
    onbooked: (booking: CreatedBooking) => void | Promise<void>;
  } = $props();

  let kind = $state<AppointmentKind>('appointment');
  let panelDirty = $state(false);
  // A fresh target is a fresh visit: never inherit the previous one's choice.
  $effect(() => {
    if (target) {
      kind = 'appointment';
      panelDirty = false;
    }
  });
</script>

<Sheet
  open={target !== null}
  title={kind === 'checkup' ? m.appt_checkup_title() : m.appt_new_title()}
  description={kind === 'checkup' ? m.appt_checkup_subtitle() : m.appt_new_subtitle()}
  size="lg"
  placement="right"
  dirty={panelDirty}
  onclose={() => onclose()}
>
  {#if target}
    <!-- Keyed on the target so a second slot click always opens on ITS
         prefill instead of the previous visit's half-filled form. -->
    {#key `${target.day}|${target.time ?? ''}|${target.resourceId ?? ''}|${target.lineId ?? ''}`}
      <AppointmentCreatePanel
        {eventTypes}
        {resources}
        {timeZone}
        {mutationScope}
        initialDate={target.day}
        initialTime={target.time ?? null}
        initialResourceId={target.resourceId ?? null}
        ticketId={target.ticketId ?? null}
        lineId={target.lineId ?? null}
        initialPartyId={target.partyId ?? null}
        initialCustomerName={target.customerName ?? null}
        initialEventTypeId={target.eventTypeId ?? null}
        lockCustomer={Boolean(target.ticketId)}
        {...bookEndpoint === undefined ? {} : { bookEndpoint }}
        {...canBook === undefined ? {} : { canBook }}
        bind:kind
        {onbooked}
        oncancel={onclose}
        bind:dirty={panelDirty}
      />
    {/key}
  {/if}
</Sheet>
