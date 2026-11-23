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
    /** Open straight on "Cerrar agenda" (the calendar's "…" menu entry, spec 147). */
    mode?: 'book' | 'close';
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
  import { SegmentedControl } from '$lib/components/ui';
  import AgendaClosureForm from './AgendaClosureForm.svelte';
  import { instantDateKey, instantParts } from '$lib/time/zoned';
  import type { CalendarClosure } from './calendar-window';
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
    closures = [],
    canClose = false,
    onclose,
    onbooked,
    onclosed,
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
    /** Loaded agenda closures (spec 147): booking into one shows a warning. */
    closures?: CalendarClosure[];
    /** Offer the "Agendar cita | Cerrar agenda" switch. */
    canClose?: boolean;
    onclose: () => void;
    onbooked: (booking: CreatedBooking) => void | Promise<void>;
    /** A closure was saved; refresh the calendar. */
    onclosed?: () => void | Promise<void>;
  } = $props();

  let mode = $state<'book' | 'close'>('book');
  const closing = $derived(mode === 'close' && canClose && !target?.ticketId);
  /** The closure the clicked slot falls in, if any — booking there is allowed, but said. */
  const closedHere = $derived.by(() => {
    if (!target) return null;
    const p = (iso: string) => {
      const x = instantParts(new Date(iso), timeZone);
      return x.hour * 60 + x.minute;
    };
    const at = target.time ? +target.time.slice(0, 2) * 60 + +target.time.slice(3, 5) : null;
    return (
      closures.find(
        (c) =>
          instantDateKey(new Date(c.start), timeZone) === target.day &&
          (at === null ||
            (at >= p(c.start) &&
              (instantDateKey(new Date(c.end), timeZone) !== target.day || at < p(c.end)))),
      ) ?? null
    );
  });

  let kind = $state<AppointmentKind>('appointment');
  let panelDirty = $state(false);
  // A fresh target is a fresh visit: never inherit the previous one's choice.
  $effect(() => {
    if (target) {
      kind = 'appointment';
      mode = target.mode ?? 'book';
      panelDirty = false;
    }
  });
</script>

<Sheet
  open={target !== null}
  title={closing
    ? m.cal_closure_mode_close()
    : kind === 'checkup'
      ? m.appt_checkup_title()
      : m.appt_new_title()}
  description={closing
    ? undefined
    : kind === 'checkup'
      ? m.appt_checkup_subtitle()
      : m.appt_new_subtitle()}
  size="lg"
  placement="right"
  dirty={panelDirty}
  onclose={() => onclose()}
>
  {#if target}
    <!-- Keyed on the target so a second slot click always opens on ITS
         prefill instead of the previous visit's half-filled form. -->
    {#if canClose && !target.ticketId}
      <div class="mode-row">
        <SegmentedControl
          aria-label={m.cal_closure_mode_label()}
          bind:value={mode}
          items={[
            { value: 'book', label: m.cal_closure_mode_book() },
            { value: 'close', label: m.cal_closure_mode_close() },
          ]}
        />
      </div>
    {/if}
    {#key `${target.day}|${target.time ?? ''}|${target.resourceId ?? ''}|${target.lineId ?? ''}|${closing}`}
      {#if closing}
        <AgendaClosureForm
          initialDate={target.day}
          initialTime={target.time ?? null}
          oncancel={onclose}
          onclosed={async () => {
            await onclosed?.();
            onclose();
          }}
          bind:dirty={panelDirty}
        />
      {:else}
        {#if closedHere}
          <p class="closure-warn t-body" role="status">
            {m.cal_closure_warning({ reason: closedHere.reason })}
          </p>
        {/if}
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
      {/if}
    {/key}
  {/if}
</Sheet>

<style>
  .mode-row {
    margin-bottom: var(--space-4);
  }
  .closure-warn {
    margin: 0 0 var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
  }
</style>
