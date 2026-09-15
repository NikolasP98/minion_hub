<script lang="ts">
  /**
   * Step 3 of the /pos/sell flow: booking the SERVICES a ticket just sold.
   *
   * Owner directive — every service invoice gets a scheduling step, OPTIONAL
   * and resumable. So this step owns no money and no cart: it reads the
   * persisted ticket back (`GET /api/pos/tickets/:id`) and lists the service
   * lines that carry no `booking_id`. Booking one is a SINGLE server call —
   * `POST /api/pos/tickets/:id/schedule` creates the appointment and stamps the
   * line in one transaction — so a failure can no longer leave an orphan
   * appointment the retry would duplicate. Nothing here can fail the sale: the
   * sale already happened.
   *
   * The booking form itself is the shared `AppointmentForm`; this is deliberately
   * NOT a third copy of it.
   */
  import { ArrowRight, CalendarPlus, Check, Info } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Badge, Button, EmptyState, Spinner, iconSizes } from '$lib/components/ui';
  import { formatDate } from '$lib/utils/format';
  import AppointmentForm, {
    type AppointmentEventType,
    type AppointmentResource,
    type CreatedBooking,
  } from '$lib/components/scheduling/AppointmentForm.svelte';

  interface Props {
    ticketId: string;
    eventTypes: AppointmentEventType[];
    resources: AppointmentResource[];
    stockEnabled: boolean;
    /** "Schedule later" / "Done" — the caller returns to a fresh cart. */
    onexit: () => void;
  }

  let { ticketId, eventTypes, resources, stockEnabled, onexit }: Props = $props();

  type Line = {
    id: string;
    kind: string;
    description: string;
    finProductId: string | null;
    bookingId: string | null;
  };

  let loading = $state(true);
  let lines = $state<Line[]>([]);
  let customerName = $state<string | null>(null);
  let partyId = $state<string | null>(null);
  let activeLineId = $state<string | null>(null);

  /** A service line with no booking is the ONE definition of "pending
   *  scheduling" — the same derivation /pos/accounts runs in SQL. */
  const pending = $derived(lines.filter((l) => l.kind === 'service' && !l.bookingId));
  const scheduled = $derived(lines.filter((l) => l.kind === 'service' && l.bookingId));
  const active = $derived(pending.find((l) => l.id === activeLineId) ?? null);
  /** The event type that sells this line's product, so the form opens on it. */
  const eventTypeFor = (l: Line) =>
    eventTypes.find((e) => e.productId && e.productId === l.finProductId)?.id ?? null;

  let seq = 0;
  async function load() {
    const token = ++seq;
    loading = true;
    try {
      const res = await fetch(`/api/pos/tickets/${ticketId}`);
      if (token !== seq) return;
      if (!res.ok) {
        lines = [];
        return;
      }
      const j = (await res.json()) as {
        ticket: { customerName: string | null; partyId: string | null };
        lines: Line[];
      };
      lines = j.lines;
      customerName = j.ticket.customerName;
      partyId = j.ticket.partyId;
    } finally {
      if (token === seq) loading = false;
    }
  }
  $effect(() => {
    void ticketId;
    void load();
  });

  /**
   * A double-submit gets the SAME appointment back with `created: false` — the
   * endpoint is idempotent. Closing the form silently would read exactly like a
   * fresh booking, so the replay is SAID OUT LOUD and the appointment it
   * resolved to is shown; otherwise the step just closes and re-reads.
   */
  let replay = $state<CreatedBooking | null>(null);

  async function onbooked(booking: CreatedBooking, created?: boolean) {
    activeLineId = null;
    replay = created === false ? booking : null;
    await load();
  }

  /** Starting another booking clears the previous replay notice. */
  function toggleLine(id: string) {
    replay = null;
    activeLineId = activeLineId === id ? null : id;
  }
</script>

<div class="sched">
  <div class="sched-head">
    <h2 class="t-title">{m.pos_sched_title()}</h2>
    <Button variant="ghost" size="sm" onclick={onexit}>
      {pending.length ? m.pos_sched_later() : m.pos_sched_done()}
      <ArrowRight size={iconSizes.sm} />
    </Button>
  </div>
  <p class="t-caption sched-sub">{m.pos_sched_subtitle()}</p>

  {#if loading}
    <Spinner />
  {:else if pending.length === 0 && scheduled.length === 0}
    <EmptyState title={m.pos_sched_nothing()} compact />
  {:else}
    {#if replay}
      <p class="replay t-caption" role="status">
        <Info size={iconSizes.xs} aria-hidden="true" />
        {m.pos_sched_already_booked({
          when: formatDate(replay.startTime, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })}
      </p>
    {/if}
    <div class="sched-body">
      <ul class="line-list">
        {#each pending as l (l.id)}
          <li class="line-row" class:is-active={activeLineId === l.id}>
            <span class="line-name">{l.description}</span>
            <Badge variant="semantic" value="warning" size="sm">{m.pos_sched_pending()}</Badge>
            <Button
              size="sm"
              variant={activeLineId === l.id ? 'primary' : 'outline'}
              onclick={() => toggleLine(l.id)}
            >
              <CalendarPlus size={iconSizes.sm} />
              {m.pos_sched_book()}
            </Button>
          </li>
        {/each}
        {#each scheduled as l (l.id)}
          <li class="line-row is-done">
            <span class="line-name">{l.description}</span>
            <Badge variant="semantic" value="success" size="sm">
              <Check size={iconSizes.xs} />
              {m.pos_sched_scheduled()}
            </Badge>
          </li>
        {/each}
      </ul>

      {#if active}
        <div class="form-panel">
          <AppointmentForm
            {eventTypes}
            {resources}
            {stockEnabled}
            initialEventTypeId={eventTypeFor(active)}
            initialPartyId={partyId}
            initialCustomerName={customerName}
            lockCustomer
            bookEndpoint={`/api/pos/tickets/${ticketId}/schedule`}
            bookPayload={{ lineId: active.id }}
            {onbooked}
            oncancel={() => (activeLineId = null)}
          />
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sched {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    height: 100%;
  }
  .sched-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-shrink: 0;
  }
  .sched-sub {
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
  .sched-body {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    min-height: 0;
    overflow-y: auto;
  }
  @media (min-width: 1024px) {
    .sched-body {
      grid-template-columns: minmax(0, 24rem) minmax(0, 1fr);
      align-items: start;
    }
  }
  /* The replay notice is information, not an error: an idempotent re-submit
     produced the right outcome, it simply was not a NEW appointment. */
  .replay {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-md);
    background: var(--color-info-surface);
    color: var(--color-info-fg);
    flex-shrink: 0;
  }
  .line-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .line-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  /* Selected row = accent-TINTED surface + accent text (list-selection
     contract); the full-accent fill stays on the action Button. */
  .line-row.is-active {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-color: var(--color-accent);
  }
  .line-row.is-done {
    opacity: 0.75;
  }
  .line-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-body);
  }
  .form-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3);
    min-width: 0;
  }
</style>
