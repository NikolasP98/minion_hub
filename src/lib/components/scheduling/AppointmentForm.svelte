<script lang="ts" module>
  export type AppointmentEventType = {
    id: string;
    title: string;
    productId?: string | null;
    /** Resources assigned to the service; when present, the Team picker is limited to them. */
    resourceIds?: string[];
    /** Duration in minutes, shown as a picker column. */
    length?: number;
  };
  export type AppointmentResource = { id: string; name: string };
  export type CreatedBooking = { id: string; startTime: string };

  type ConsumptionLine = {
    itemId: string;
    itemName: string;
    uom: string;
    qty: number;
    qtyConsumption: number;
    consumptionUom: string | null;
    unitsPerStockUom: number | null;
    subunitsPerStockUom: number | null;
    diagramEnabled: boolean;
    available: number;
    committedOther: number;
    atp: number;
  };
</script>

<script lang="ts">
  /**
   * Reusable "book an appointment" form. Lifted verbatim out of the
   * `/pos/appointments` modal (service picker, staff override, slot grid, stock
   * consumption, customer search/quick-add) so the page at
   * `/pos/appointments/new` and, later, the scheduling side render ONE form
   * instead of a third copy.
   */
  import { untrack } from 'svelte';
  import { Button, PickerCombobox, type PickerColumn } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatTime } from '$lib/utils/format';

  interface Props {
    eventTypes: AppointmentEventType[];
    resources: AppointmentResource[];
    stockEnabled: boolean;
    /** Prefill from a calendar slot click. */
    initialDate?: string | null;
    initialTime?: string | null;
    initialResourceId?: string | null;
    /** Prefill from an already-sold ticket line (/pos/sell `?step=schedule`):
     *  the service and the client are settled facts there, so the form opens on
     *  the slot grid instead of re-asking for them. */
    initialEventTypeId?: string | null;
    initialPartyId?: string | null;
    initialCustomerName?: string | null;
    initialPhone?: string | null;
    /** Hide the customer picker entirely when the caller owns the identity. */
    lockCustomer?: boolean;
    /** Where the booking POST goes. The POS sell flow points it at
     *  `/api/pos/tickets/:id/schedule`, which creates the booking AND stamps the
     *  ticket line in ONE transaction. Both endpoints answer `{ booking }`. */
    bookEndpoint?: string;
    /** Extra body fields merged into that POST (the POS `lineId`, for one). */
    bookPayload?: Record<string, unknown>;
    /** Bindable so a host can drive the service pick programmatically (e.g. a
     *  "draw from package" selector choosing the grant's service). */
    eventTypeId?: string;
    /** Bindable so a host that already knows the client (CustomerPicker inside
     *  this form) can read the pick back — the POST body itself never sends
     *  this field unless the host adds it via `bookPayload`. */
    partyId?: string | null;
    /** `created` is false when the server answered an IDEMPOTENT REPLAY: the
     *  SAME appointment, not a second one (`POST /api/pos/tickets/:id/schedule`).
     *  Optional, so a caller that does not care ignores it. */
    onbooked: (booking: CreatedBooking, created?: boolean) => void | Promise<void>;
    oncancel: () => void;
  }

  let {
    eventTypes,
    resources,
    stockEnabled,
    initialDate = null,
    initialTime = null,
    initialResourceId = null,
    initialEventTypeId = null,
    initialPartyId = null,
    initialCustomerName = null,
    initialPhone = null,
    lockCustomer = false,
    bookEndpoint = '/api/scheduling/bookings',
    bookPayload,
    eventTypeId = $bindable(initialEventTypeId ?? ''),
    partyId = $bindable(initialPartyId),
    onbooked,
    oncancel,
  }: Props = $props();

  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // svelte-ignore state_referenced_locally
  let day = $state(initialDate ?? localToday);
  let slots = $state<Array<{ start: string; end: string }>>([]);
  let slot = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  // Shared POS CustomerPicker (party search + persisting quick-add). The booking
  // API resolves/creates the CRM contact from the phone, so name+phone is all it
  // needs.
  // svelte-ignore state_referenced_locally -- seed once from the prefill props
  let customerName = $state<string | null>(initialCustomerName);
  // svelte-ignore state_referenced_locally
  let phone = $state<string | null>(initialPhone);
  let docNumber = $state<string | null>(null);

  let lines = $state<ConsumptionLine[]>([]);
  let hasMapping = $state(false);
  let gen = 0; // generation token: a stale fetch must not overwrite a newer pick

  // Walk-in extras: force a staff member, optionally booking off-grid with an
  // exact typed start.
  // svelte-ignore state_referenced_locally
  let forceResourceId = $state(initialResourceId ?? '');
  // Only the service's assignees can be forced: createBooking filters the
  // candidates by the forced id and answers 409 for anyone else (prod
  // 2026-09-17: "Consulta" is Renzo GT + Leiva; picking Martin always failed).
  // A service without the list (older callers) keeps every resource.
  const teamOptions = $derived.by(() => {
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (!et?.resourceIds) return resources;
    const allowed = new Set(et.resourceIds);
    return resources.filter((r) => allowed.has(r.id));
  });
  $effect(() => {
    // A prefilled or previously picked member who is not on the new service
    // falls back to "Any" instead of a guaranteed 409.
    if (forceResourceId && !teamOptions.some((r) => r.id === forceResourceId)) forceResourceId = '';
  });
  // Team combobox rows: "Any" is a real row (sentinel id) so the primitive
  // picker can offer it too; '' stays the form's own "no forced resource".
  const ANY_TEAM = '__any__';
  const teamItems = $derived<AppointmentResource[]>([
    { id: ANY_TEAM, name: m.pos_appt_staff_any() },
    ...teamOptions,
  ]);
  const teamChoice = $derived(forceResourceId || ANY_TEAM);
  const setTeam = (v: string) => (forceResourceId = v === ANY_TEAM ? '' : v);
  const serviceColumns: PickerColumn<AppointmentEventType>[] = [
    {
      key: 'title',
      label: m.sched_booking_service(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'length',
      label: m.sched_et_length(),
      value: (e) => (e.length ? `${e.length} min` : ''),
      align: 'right',
      priority: 20,
    },
  ];
  const teamColumns: PickerColumn<AppointmentResource>[] = [
    {
      key: 'name',
      label: m.sched_nav_resources(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
  ];
  let overrideChecked = $state(false);
  let overrideTime = $state('');
  const overrideActive = $derived(Boolean(forceResourceId) && overrideChecked);

  /** Consumed once: a slot click's time preselects a slot, or seeds the override. */
  // svelte-ignore state_referenced_locally
  let pendingTime: string | null = initialTime;

  function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
  }

  /** Same 24-hour "HH:MM" as before — now via the shared locale-pinned helper,
   *  so the slot grid, the calendar chips and the axis can't drift apart.
   *  Also the key `pendingTime` is matched against, hence the stable 2-digit form. */
  const hhmm = (iso: string) => formatTime(iso);

  async function loadConsumption() {
    const token = ++gen;
    lines = [];
    hasMapping = false;
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (!et?.productId || !stockEnabled || !canAct('stock', 'view')) return;
    try {
      const res = await fetch('/api/stock/accruals/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finProductId: et.productId, quantity: 1 }),
      });
      if (!res.ok) return; // no warehouse / stock off — the block stays hidden
      const j = await res.json();
      if (token !== gen) return; // a newer selection superseded this fetch
      hasMapping = j.preview.hasMapping;
      lines = j.preview.lines;
    } catch {
      /* preview is best-effort */
    }
  }

  async function loadSlots() {
    if (!eventTypeId || !day) return;
    busy = true;
    err = null;
    slot = '';
    // Half-open window resolved from the picked day: `< day + 1` never drops the
    // evening the way a midnight `<=` bound would.
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    try {
      const res = await fetch(
        `/api/scheduling/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      slots = res.ok ? ((await res.json()).slots ?? []) : [];
      if (pendingTime) {
        const match = slots.find((s) => hhmm(s.start) === pendingTime);
        if (match) slot = match.start;
        else overrideTime = pendingTime;
        pendingTime = null;
      }
    } finally {
      busy = false;
    }
  }

  async function book() {
    if (!eventTypeId || !customerName?.trim() || (overrideActive ? !overrideTime : !slot)) {
      err = m.appt_new_required();
      return;
    }
    busy = true;
    err = null;
    try {
      // The server requires qtyConsumption > 0 per line; a gauge dragged to 0 (or
      // a typed negative) must not fail the whole booking — drop non-positive
      // lines instead.
      const positiveLines = hasMapping ? lines.filter((l) => l.qtyConsumption > 0) : [];
      const start = overrideActive ? new Date(`${day}T${overrideTime}:00`).toISOString() : slot;
      const res = await fetch(bookEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...bookPayload,
          eventTypeId,
          start,
          attendeeName: customerName,
          attendeePhone: phone || null,
          partyId: partyId || null,
          forceResourceId: forceResourceId || undefined,
          // BOTH staff-forced AND the checkbox are required — never send this
          // from just a forced resource pick.
          overrideConflicts: overrideActive ? true : undefined,
          consumption: positiveLines.length
            ? positiveLines.map((l) => ({ itemId: l.itemId, qtyConsumption: l.qtyConsumption }))
            : null,
        }),
      });
      if (res.status === 409) {
        // The atomic POS endpoint answers `{error, code}`; a conflict there is
        // not always the slot (a line another cashier just booked, an exhausted
        // package), and reloading the grid would explain nothing.
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code && body.code !== 'slot_unavailable') {
          err =
            body.code === 'line_already_scheduled'
              ? m.pos_sched_already_scheduled()
              : body.code === 'resource_not_assigned'
                ? m.sched_book_resource_not_assigned()
                : m.appt_new_failed();
          return;
        }
        err = m.sched_book_unavailable();
        if (!overrideActive) await loadSlots();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { booking, created } = (await res.json()) as {
        booking: CreatedBooking;
        created?: boolean;
      };
      await onbooked(booking, created);
    } catch {
      err = m.appt_new_failed();
    } finally {
      busy = false;
    }
  }

  // A prefilled/programmatically-picked service (calendar prefill, POS
  // ticket link, or a "draw from package" selector driving `bind:eventTypeId`
  // from outside) must land on its slot grid without a manual re-pick.
  $effect(() => {
    // Track ONLY eventTypeId — loadSlots also reads `day`, which has its own
    // onchange trigger on the date input; without `untrack` this effect would
    // re-fire on every day change too and double the fetch.
    if (eventTypeId) {
      untrack(() => {
        loadSlots();
        loadConsumption();
      });
    }
  });

  const canBook = $derived(canAct('scheduling', 'edit'));
  const submitDisabled = $derived(
    busy || (overrideActive ? !overrideTime : !slot) || !customerName?.trim() || !canBook,
  );
</script>

<div class="appt-form">
  <!-- Owner 2026-09-17: both fields are "primitive picker comboboxes" — type
       to filter, or open the Picker from the icon. Team rows are already the
       service's assignees (teamOptions), so every path respects that filter. -->
  <PickerCombobox
    id="appt-service"
    label={m.sched_book_choose_service()}
    items={eventTypes}
    itemToValue={(e) => e.id}
    itemToString={(e) => e.title}
    bind:value={eventTypeId}
    placeholder={m.sched_book_choose_service()}
    pickerTitle={m.sched_book_choose_service()}
    columns={serviceColumns}
    emptyLabel={m.sched_empty_eventTypes()}
    storageKey="sched-service"
  />

  <PickerCombobox
    id="appt-team"
    label={m.sched_nav_resources()}
    items={teamItems}
    itemToValue={(r) => r.id}
    itemToString={(r) => r.name}
    value={teamChoice}
    onchange={setTeam}
    disabled={!eventTypeId}
    placeholder={m.pos_appt_staff_any()}
    pickerTitle={m.sched_et_pick_team()}
    columns={teamColumns}
    storageKey="sched-team"
  />

  <FormField label={m.sched_book_pick_time()}>
    {#snippet children(field)}
      <input id={field.id} class="txt" type="date" bind:value={day} onchange={loadSlots} />
    {/snippet}
  </FormField>

  {#if busy && !slots.length}
    <p class="t-caption">…</p>
  {:else if eventTypeId && slots.length === 0 && !overrideActive}
    <p class="t-caption">{m.sched_book_no_slots()}</p>
  {:else if slots.length && !overrideActive}
    <div class="slot-grid">
      {#each slots as s (s.start)}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="slot {slot === s.start ? 'slot-on' : ''}"
          aria-pressed={slot === s.start}
          onclick={() => (slot = s.start)}
        >
          {hhmm(s.start)}
        </Button>
      {/each}
    </div>
  {/if}

  {#if forceResourceId && canBook}
    <div class="override-box">
      <label class="check-row">
        <input type="checkbox" bind:checked={overrideChecked} />
        <span class="t-caption">{m.pos_walkin_override()}</span>
      </label>
      {#if overrideChecked}
        <input class="txt txt-narrow" type="time" bind:value={overrideTime} />
      {/if}
    </div>
  {/if}

  {#if hasMapping && lines.length}
    <div class="block">
      <span class="t-caption">{m.sched_stock_consumption()}</span>
      <div class="lines">
        {#each lines as l (l.itemId)}
          {@const gMax = l.diagramEnabled
            ? gaugeMax({
                uom: l.uom,
                unitsPerStockUom: l.unitsPerStockUom,
                subunitsPerStockUom: l.subunitsPerStockUom,
              })
            : 0}
          <div class="line">
            <span class="line-name">{l.itemName}</span>
            {#if gMax > 0}
              <ConsumptionGauge
                max={gMax}
                unit={l.consumptionUom ?? l.uom}
                bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
              />
            {:else}
              <input
                class="txt txt-narrow"
                type="number"
                min="0"
                step="any"
                value={l.qtyConsumption}
                oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
              />
              <span class="t-caption">{l.consumptionUom ?? l.uom}</span>
            {/if}
            {#if l.qty > l.atp}
              <span class="t-caption danger"
                >{m.sched_stock_atp_warn({ atp: String(l.atp), uom: l.uom })}</span
              >
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if lockCustomer && customerName}
    <p class="t-caption">{customerName}</p>
  {:else}
    <!-- A walk-in ticket (`?step=schedule`, no client at sale time) has no
         customer to lock to — mount the same picker the sell step uses so the
         cashier can search or quick-add one here instead of being stuck. -->
    <CustomerPicker bind:partyId bind:customerName bind:phone bind:docNumber />
  {/if}
  {#if !customerName}
    <p class="t-caption">{m.sched_book_find_client_ph()}</p>
  {/if}

  {#if err}<p class="t-caption danger" role="alert">{err}</p>{/if}

  <div class="actions">
    <Button
      onclick={book}
      disabled={submitDisabled}
      title={canBook ? undefined : m.no_permission()}
    >
      {m.sched_book_confirm()}
    </Button>
    <Button variant="ghost" onclick={oncancel}>{m.sched_cancel()}</Button>
  </div>
</div>

<style>
  .appt-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 44rem;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .line-name {
    min-width: 8rem;
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
  }
  .txt {
    width: 100%;
    height: var(--control-height-md);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
  }
  .txt-narrow {
    width: 7rem;
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--space-2);
    max-height: 13rem;
    overflow: auto;
  }
  /* Slot picks are a SELECTION, not a primary action: accent-tinted pill +
     accent text, never a full accent fill (governance list-selection contract).
     Forwarded classes on a shared Button need `:global` off a scoped ancestor. */
  .slot-grid :global(.slot) {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .slot-grid :global(.slot-on) {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
    font-weight: 600;
  }
  .override-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .danger {
    color: var(--color-danger-fg);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
