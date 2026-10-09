<script lang="ts" module>
  export type AppointmentEventType = {
    id: string;
    title: string;
    productId?: string | null;
    /** Resources assigned to the service; when present, the Team picker is limited to them. */
    resourceIds?: string[];
    /** Duration in minutes, shown as a picker column. */
    length?: number;
    /** Catalog list price (`fin_products.unit_price` via `productId`), from
     *  `listEventTypes`. Null/absent = not priced — the column renders "—". */
    price?: number | null;
    /** Currency of `price` (the org's POS currency). */
    currency?: string | null;
  };
  export type AppointmentResource = { id: string; name: string };
  export type CreatedBooking = { id: string; startTime: string };
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
  import { page } from '$app/state';
  import { Check, MoreHorizontal, Plus, Trash2 } from 'lucide-svelte';
  import {
    Button,
    Dropdown,
    Picker,
    PickerCombobox,
    iconSizes,
    type DropdownItem,
    type PickerColumn,
  } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    MutationRejected,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import { syncPreferenceToServer } from '$lib/state/ui/preference-sync.svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney, formatTime } from '$lib/utils/format';
  import { todayIn } from './calendar-window';
  import { resolveCalendarInstant, schedulingSlotWindow } from './calendar-time';
  import { serviceColumns } from './service-picker-columns';

  interface Props {
    eventTypes: AppointmentEventType[];
    resources: AppointmentResource[];
    /** IANA organization timezone used for slot reads, labels, and overrides. */
    timeZone: string;
    /** Active organization + action boundary captured by slot/override state. */
    mutationScope: string;
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
    /** Overrides the default `scheduling:edit` gate on the Book button. */
    canBook?: boolean;
    /** Extra body fields merged into that POST (the POS `lineId`, for one). */
    bookPayload?: Record<string, unknown>;
    /** Bindable so a host can drive the service pick programmatically (e.g. a
     *  "draw from package" selector choosing the grant's service). */
    eventTypeId?: string;
    /** Offer MORE than one procedure in one visit: picking a second turns the
     *  booking into a CONTAINER visit (one client, one chair, the procedures
     *  back-to-back on a shared window). Off everywhere else, notably on the POS
     *  ticket-link path whose endpoint stamps exactly one line. */
    multiService?: boolean;
    /** The procedures AFTER the lead `eventTypeId`, in pick order — which is the
     *  visit's `groupSeq`. Bindable so a host can tell single from multi (the
     *  package draw is a single-service affordance). */
    extraEventTypeIds?: string[];
    /** Bindable so a host that already knows the client (CustomerPicker inside
     *  this form) can read the pick back — the POST body itself never sends
     *  this field unless the host adds it via `bookPayload`. */
    partyId?: string | null;
    /** `created` is false when the server answered an IDEMPOTENT REPLAY: the
     *  SAME appointment, not a second one (`POST /api/pos/tickets/:id/schedule`).
     *  Optional, so a caller that does not care ignores it. */
    onbooked: (booking: CreatedBooking, created?: boolean) => void | Promise<void>;
    oncancel: () => void;
    /** Bindable: true once the visitor has picked a service, a customer, a
     *  team override, a slot, or moved off the prefilled day — so a host
     *  dialog (`Sheet`'s `dirty` prop) can guard an accidental dismiss. */
    dirty?: boolean;
  }

  let {
    eventTypes,
    resources,
    timeZone,
    mutationScope,
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
    canBook: canBookProp,
    eventTypeId = $bindable(initialEventTypeId ?? ''),
    multiService = false,
    extraEventTypeIds = $bindable<string[]>([]),
    partyId = $bindable(initialPartyId),
    onbooked,
    oncancel,
    dirty = $bindable(false),
  }: Props = $props();

  const localToday = untrack(() => todayIn(timeZone));

  // svelte-ignore state_referenced_locally
  let day = $state(initialDate ?? localToday);
  let slots = $state<Array<{ start: string; end: string }>>([]);
  let slot = $state('');
  let slotsLoading = $state(false);
  let submitting = $state(false);
  let submitBlocked = $state<'committed' | 'unknown' | null>(null);
  let err = $state<string | null>(null);
  let slotError = $state<string | null>(null);
  let slotScope = $state<{ mutationScope: string; timeZone: string } | null>(null);
  let slotsGeneration = 0;
  const actions = tryUseActions();

  // Shared POS CustomerPicker (party search + persisting quick-add). The booking
  // API resolves/creates the CRM contact from the phone, so name+phone is all it
  // needs.
  // svelte-ignore state_referenced_locally -- seed once from the prefill props
  let customerName = $state<string | null>(initialCustomerName);
  // svelte-ignore state_referenced_locally
  let phone = $state<string | null>(initialPhone);
  let docNumber = $state<string | null>(null);

  // Walk-in extras: force a staff member, optionally booking off-grid with an
  // exact typed start.
  // svelte-ignore state_referenced_locally
  let forceResourceId = $state(initialResourceId ?? '');
  /** The visit, in order: the lead pick then the extras. `groupSeq` is the index.
   *  Length 1 (or 0) is an ordinary single booking. */
  const picked = $derived(eventTypeId ? [eventTypeId, ...extraEventTypeIds] : []);
  const pickedTypes = $derived(
    picked.map((id) => eventTypes.find((e) => e.id === id)).filter((e) => e !== undefined),
  );
  /** The container window: the procedures run back-to-back with no gap between
   *  them, so the visit is exactly the sum of their own lengths (the same
   *  arithmetic the server's `planGroupMerge` does). */
  const totalMinutes = $derived(pickedTypes.reduce((sum, e) => sum + (e.length ?? 0), 0));

  // Only the service's assignees can be forced: createBooking filters the
  // candidates by the forced id and answers 409 for anyone else (prod
  // 2026-09-17: "Consulta" is Renzo GT + Leiva; picking Martin always failed).
  // A service without the list (older callers) keeps every resource. A visit of
  // several procedures is ONE chair, so the options are the INTERSECTION — the
  // same narrowing the slots endpoint applies before it offers a time.
  const teamOptions = $derived.by(() => {
    let out = resources;
    for (const et of pickedTypes) {
      if (!et.resourceIds) continue;
      const allowed = new Set(et.resourceIds);
      out = out.filter((r) => allowed.has(r.id));
    }
    return out;
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
  const svcColumns = serviceColumns<AppointmentEventType>();
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

  /** Picked-services table (owner 2026-09-30: a basic table instead of pills,
   *  configurable per-user which columns show). `title` is always visible;
   *  `duration`/`price` can be hidden via the kebab, persisted server-side. */
  const svcTableColumns: DataColumn<AppointmentEventType>[] = [
    { key: 'title', label: m.sched_booking_service(), fill: true, custom: true },
    { key: 'duration', label: m.sched_et_length(), custom: true, align: 'right' },
    { key: 'price', label: m.pos_sell_price(), custom: true, align: 'right' },
  ];
  const SVC_HIDEABLE_COLUMNS = ['duration', 'price'] as const;
  const apptServicesColumnPrefs = $derived(
    (
      page.data as {
        preferences?: { preferences?: { appointmentServicesColumns?: unknown } };
      }
    )?.preferences?.preferences?.appointmentServicesColumns,
  );
  // svelte-ignore state_referenced_locally -- seeded once from the server bundle
  let hiddenColumns = $state<string[]>(
    Array.isArray(apptServicesColumnPrefs)
      ? apptServicesColumnPrefs.filter((k): k is string => typeof k === 'string')
      : [],
  );
  $effect(() => {
    hiddenColumns = Array.isArray(apptServicesColumnPrefs)
      ? apptServicesColumnPrefs.filter((k): k is string => typeof k === 'string')
      : [];
  });
  const visibleSvcColumns = $derived(svcTableColumns.filter((c) => !hiddenColumns.includes(c.key)));
  const svcColumnMenuItems = $derived<DropdownItem[]>(
    SVC_HIDEABLE_COLUMNS.map((key) => ({
      value: key,
      label: key === 'duration' ? m.sched_et_length() : m.pos_sell_price(),
      icon: hiddenColumns.includes(key) ? undefined : Check,
      closeOnSelect: false,
    })),
  );
  function toggleSvcColumn(key: string) {
    hiddenColumns = hiddenColumns.includes(key)
      ? hiddenColumns.filter((k) => k !== key)
      : [...hiddenColumns, key];
    syncPreferenceToServer('appointmentServicesColumns', hiddenColumns);
  }
  /** `listEventTypes` joins `fin_products.unit_price` through the service's
   *  `productId`; an unpriced service stays undefined so the column shows "—"
   *  rather than a 0 the operator would read as free.
   *
   *  TODO(handoff): the Price cell still formats with `formatMoney`'s PEN
   *  default. `et.currency` carries the org's actual POS currency — pass it as
   *  `formatMoney(svcPrice(et), et.currency ?? undefined)` in the `priceCell`
   *  snippet below. Only matters for a non-PEN org. */
  function svcPrice(et: AppointmentEventType): number | undefined {
    return et.price ?? undefined;
  }
  let overrideChecked = $state(false);
  let overrideTime = $state('');
  const overrideActive = $derived(Boolean(forceResourceId) && overrideChecked);
  let overrideScope = $state<{ mutationScope: string; timeZone: string } | null>(null);
  $effect(() => {
    if (overrideActive) {
      untrack(() => {
        overrideScope ??= { mutationScope, timeZone };
      });
    } else {
      overrideScope = null;
    }
  });

  /** Consumed once: a slot click's time preselects a slot, or seeds the override. */
  // svelte-ignore state_referenced_locally
  let pendingTime: string | null = initialTime;
  const pendingScope = untrack(() => (initialTime ? { mutationScope, timeZone } : null));

  let submitScopeKey = untrack(() => `${mutationScope}\u0000${timeZone}\u0000${bookEndpoint}`);
  $effect(() => {
    const next = `${mutationScope}\u0000${timeZone}\u0000${bookEndpoint}`;
    if (next === submitScopeKey) return;
    submitScopeKey = next;
    submitBlocked = null;
    err = null;
  });

  /** Same 24-hour "HH:MM" as before — now via the shared locale-pinned helper,
   *  so the slot grid, the calendar chips and the axis can't drift apart.
   *  Also the key `pendingTime` is matched against, hence the stable 2-digit form. */
  const hhmm = (iso: string) => formatTime(iso, timeZone);

  async function loadSlots() {
    if (!eventTypeId || !day) return;
    const token = ++slotsGeneration;
    const requestScope = { mutationScope, timeZone };
    slotsLoading = true;
    if (!submitting && !submitBlocked) err = null;
    slotError = null;
    slot = '';
    slotScope = null;
    if (
      pendingTime &&
      pendingScope &&
      (pendingScope.mutationScope !== requestScope.mutationScope ||
        pendingScope.timeZone !== requestScope.timeZone)
    ) {
      pendingTime = null;
      overrideTime = '';
    }
    const window = schedulingSlotWindow(day, requestScope.timeZone);
    if (!window.ok) {
      slots = [];
      slotError = window.kind === 'nonexistent' ? m.cal_time_nonexistent() : m.cal_time_invalid();
      slotsLoading = false;
      return;
    }
    if (!window.from || !window.to) {
      slots = [];
      slotError = m.cal_time_invalid();
      slotsLoading = false;
      return;
    }
    // The extras make the grid offer slots long enough for the WHOLE visit, on a
    // resource assigned to every procedure — the server is the one that knows the
    // durations and the assignees, so the form only names the picks.
    const withIds = extraEventTypeIds.length
      ? `&withEventTypeIds=${extraEventTypeIds.map(encodeURIComponent).join(',')}`
      : '';
    try {
      const slotsEndpoint = bookEndpoint.startsWith('/api/pos/')
        ? '/api/pos/appointments/slots'
        : '/api/scheduling/slots';
      const res = await fetch(
        `${slotsEndpoint}?eventTypeId=${eventTypeId}&from=${window.from.toISOString()}&to=${window.to.toISOString()}${withIds}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextSlots = ((await res.json()).slots ?? []) as Array<{ start: string; end: string }>;
      if (
        token !== slotsGeneration ||
        requestScope.mutationScope !== mutationScope ||
        requestScope.timeZone !== timeZone
      )
        return;
      slots = nextSlots;
      slotScope = requestScope;
      if (pendingTime) {
        const match = slots.find((s) => hhmm(s.start) === pendingTime);
        // Seeded, not typed: a slot-click's time lands AFTER the slots load,
        // so the dirty snapshot (taken at init) learns it here instead.
        if (match) {
          slot = match.start;
          seeded.slot = match.start;
        } else {
          overrideTime = pendingTime;
          seeded.overrideTime = pendingTime;
        }
        pendingTime = null;
      }
    } catch {
      if (
        token !== slotsGeneration ||
        requestScope.mutationScope !== mutationScope ||
        requestScope.timeZone !== timeZone
      )
        return;
      slots = [];
      slotScope = null;
      slotError = m.sched_slots_unavailable();
    } finally {
      if (token === slotsGeneration) slotsLoading = false;
    }
  }

  async function book() {
    if (submitting || submitBlocked) return;
    if (!eventTypeId || !customerName?.trim() || (overrideActive ? !overrideTime : !slot)) {
      err = m.appt_new_required();
      return;
    }
    const requestScope = { mutationScope, timeZone };
    const requestEndpoint = bookEndpoint;
    const requestOnBooked = onbooked;
    const scopeVersion = actions?.scopeVersion;
    const requestIsCurrent = () =>
      requestScope.mutationScope === mutationScope &&
      requestScope.timeZone === timeZone &&
      requestEndpoint === bookEndpoint &&
      (!actions || actions.scopeVersion === scopeVersion);
    submitting = true;
    err = null;
    try {
      let start = slot;
      if (overrideActive) {
        if (
          !overrideScope ||
          overrideScope.mutationScope !== mutationScope ||
          overrideScope.timeZone !== timeZone
        ) {
          overrideChecked = false;
          overrideTime = '';
          err = m.cal_gesture_scope_changed();
          return;
        }
        const [hour, minute] = overrideTime.split(':').map(Number);
        const resolved = resolveCalendarInstant(day, hour * 60 + minute, overrideScope.timeZone);
        if (!resolved.ok) {
          err = resolved.kind === 'nonexistent' ? m.cal_time_nonexistent() : m.cal_time_invalid();
          return;
        }
        start = resolved.instant.toISOString();
      } else if (
        !slotScope ||
        slotScope.mutationScope !== mutationScope ||
        slotScope.timeZone !== timeZone
      ) {
        err = m.cal_gesture_scope_changed();
        return;
      }
      const requestBody = {
        ...bookPayload,
        eventTypeId,
        // Only ever sent with 2+ procedures, so the single-booking create path
        // is reached with exactly the body it has always been reached with.
        eventTypeIds: picked.length > 1 ? picked : undefined,
        start,
        attendeeName: customerName,
        attendeePhone: phone || null,
        partyId: partyId || null,
        forceResourceId: forceResourceId || undefined,
        // BOTH staff-forced AND the checkbox are required — never send this
        // from just a forced resource pick.
        overrideConflicts: overrideActive ? true : undefined,
        // No consumption lines from the planner (owner 2026-09-17: adjustments
        // happen AFTER attendance is confirmed) — the server accrues the
        // service's default stk_consumption mapping.
      };
      let conflictCode: string | undefined;
      let acceptedResponse: Response | undefined;
      const outcome = await runTrackedCommand(actions, 'scheduling.appointment.create', (context) =>
        runCheckedMutation({
          context,
          attemptId: 'scheduling.appointment.create.write',
          mutate: async (signal) => {
            const response = await fetch(requestEndpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(requestBody),
              signal,
            });
            if (response.status === 409) {
              // The atomic POS endpoint answers `{error, code}`; a conflict there
              // is not always a slot, so only slot conflicts reload the grid.
              const body = (await response.json().catch(() => null)) as {
                code?: string;
              } | null;
              conflictCode = body?.code;
              const message =
                conflictCode === 'line_already_scheduled'
                  ? m.pos_sched_already_scheduled()
                  : conflictCode === 'resource_not_assigned'
                    ? m.sched_book_resource_not_assigned()
                    : conflictCode && conflictCode !== 'slot_unavailable'
                      ? m.appt_new_failed()
                      : m.sched_book_unavailable();
              throw new MutationRejected(response.status, message);
            }
            if (!response.ok) throw new MutationRejected(response.status, m.appt_new_failed());
            acceptedResponse = response;
            return response;
          },
          onCommitted: () => {
            if (requestIsCurrent()) submitBlocked = 'committed';
          },
          refresh: async () => {
            if (!requestIsCurrent()) return;
            const { booking, created } = (await acceptedResponse!.json()) as {
              booking: CreatedBooking;
              created?: boolean;
            };
            if (!requestIsCurrent()) return;
            await requestOnBooked(booking, created);
          },
          refreshAttemptId: 'scheduling.appointment.create.refresh',
        }),
      );
      if (!requestIsCurrent()) return;
      if (outcome.status === 'succeeded') return;
      if (outcome.status === 'committed-refreshing') {
        submitBlocked = 'committed';
        err = m.asyncAction_refreshing();
        return;
      }
      if (outcome.status === 'unknown') {
        submitBlocked = 'unknown';
        err = m.asyncAction_unknown();
        return;
      }
      if (outcome.status === 'conflict') {
        if ((!conflictCode || conflictCode === 'slot_unavailable') && !overrideActive)
          await loadSlots();
      }
      if (outcome.status === 'partial') {
        err = m.asyncAction_partial();
        return;
      }
      err = outcome.error instanceof Error ? outcome.error.message : m.appt_new_failed();
    } catch (error) {
      if (requestIsCurrent()) {
        submitBlocked = 'unknown';
        err = error instanceof Error ? error.message : m.asyncAction_unknown();
      }
    } finally {
      submitting = false;
    }
  }

  // A prefilled/programmatically-picked service (calendar prefill, POS
  // ticket link, or a "draw from package" selector driving `bind:eventTypeId`
  // from outside) must land on its slot grid without a manual re-pick.
  $effect(() => {
    // Track ONLY eventTypeId (and the extras, which change the visit's length and
    // therefore the whole grid) — loadSlots also reads `day`, which has its own
    // onchange trigger on the date input; without `untrack` this effect would
    // re-fire on every day change too and double the fetch.
    picked.join(',');
    void mutationScope;
    void timeZone;
    if (eventTypeId) {
      untrack(() => loadSlots());
    }
  });

  /** ONE service field (owner 2026-09-26: "a single service picker that behaves
   *  like the 'new entry' primitive item picker… pick 1 or more items in a single
   *  shot"). The picker is the same `Picker` primitive stock entries use in
   *  `selectionMode="multiple"`: it stays open, every tick lands here, and
   *  `pickedIds` below is authoritative, so closing it IS the confirm. Pick order
   *  is the visit's `groupSeq`. */
  let servicePickerOpen = $state(false);
  const pickedIds = $derived(new Set(picked));
  function pickService(et: AppointmentEventType) {
    if (!multiService) {
      eventTypeId = et.id;
      extraEventTypeIds = [];
      return;
    }
    if (!eventTypeId) eventTypeId = et.id;
    else if (!pickedIds.has(et.id)) extraEventTypeIds = [...extraEventTypeIds, et.id];
  }
  function unpickService(et: AppointmentEventType) {
    const index = picked.indexOf(et.id);
    if (index >= 0) removeProcedure(index);
  }

  /** Dropping the lead promotes the next procedure — the visit keeps its order,
   *  and one procedure left is simply a plain booking again. */
  function removeProcedure(index: number) {
    if (index === 0) {
      eventTypeId = extraEventTypeIds[0] ?? '';
      extraEventTypeIds = extraEventTypeIds.slice(1);
      return;
    }
    extraEventTypeIds = extraEventTypeIds.filter((_, i) => i !== index - 1);
  }

  // Hosts on a POS surface pass their own capability (a cashier books with
  // `pos:create` through /api/pos/appointments, no scheduling role needed).
  const canBook = $derived(canBookProp ?? canAct('scheduling', 'edit'));
  const submitDisabled = $derived(
    slotsLoading ||
      submitting ||
      submitBlocked !== null ||
      (overrideActive ? !overrideTime : !slot) ||
      !customerName?.trim() ||
      !canBook,
  );

  // Dirty = differs from what the form OPENED with. A tray opened from a slot
  // click or a package draw is prefilled (slot, service, customer) and must
  // not prompt "discard?" when the user clicks away without touching it; a
  // value the user changed afterwards must. `initial` is read once, untracked.
  // Values the form seeds itself after mount (the slot-click time once the
  // slots arrive) are written here too, so they compare equal, not dirty.
  const seeded = $state({ slot: '', overrideTime: '' });
  const dirtyFields = () => ({
    partyId: partyId ?? '',
    eventTypeId: eventTypeId ?? '',
    extra: [...extraEventTypeIds].join(','),
    customerName: customerName?.trim() ?? '',
    phone: phone?.trim() ?? '',
    docNumber: docNumber?.trim() ?? '',
    forceResourceId: forceResourceId ?? '',
    slot: slot === seeded.slot ? '' : slot,
    day,
    overrideChecked,
    overrideTime: overrideTime === seeded.overrideTime ? '' : overrideTime,
  });
  const initial = untrack(() => JSON.stringify(dirtyFields()));
  const computedDirty = $derived(JSON.stringify(dirtyFields()) !== initial);
  $effect(() => {
    dirty = computedDirty;
  });
</script>

<div class="appt-form">
  {#if lockCustomer && customerName}
    <p class="t-caption">{customerName}</p>
  {:else}
    <!-- Customer is a primary field (owner 2026-09-30): first in the form,
         above the service picker. A walk-in ticket (`?step=schedule`, no
         client at sale time) has no customer to lock to — mount the same
         picker the sell step uses so the cashier can search or quick-add one
         here instead of being stuck. -->
    <CustomerPicker bind:partyId bind:customerName bind:phone bind:docNumber />
  {/if}
  {#if !customerName}
    <p class="t-caption">{m.sched_book_find_client_ph()}</p>
  {/if}

  <!-- Owner 2026-09-30: a basic table instead of pills, with a tiny kebab to
       show/hide the Duration/Price columns per user, and the "+ Add" button
       as the table's own footer row so it reads the same with 0 or N rows. -->
  <div class="svc-section">
    <div class="svc-head">
      <span class="t-label">{m.sched_book_choose_service()}</span>
      <Dropdown items={svcColumnMenuItems} onSelect={toggleSvcColumn} placement="bottom">
        {#snippet trigger()}
          <span class="svc-kebab" aria-label={m.appt_services_columns_menu()}>
            <MoreHorizontal size={iconSizes.xs} aria-hidden="true" />
          </span>
        {/snippet}
      </Dropdown>
    </div>
    <div class="svc-table">
      {#if pickedTypes.length > 0}
        {#snippet titleCell(et: AppointmentEventType)}
          {et.title}
        {/snippet}
        {#snippet durationCell(et: AppointmentEventType)}
          {et.length ? `${et.length} min` : '—'}
        {/snippet}
        {#snippet priceCell(et: AppointmentEventType)}
          {formatMoney(svcPrice(et))}
        {/snippet}
        {#snippet svcRowActions(et: AppointmentEventType)}
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            aria-label={m.common_remove()}
            onclick={() => unpickService(et)}
          >
            <Trash2 size={iconSizes.xs} aria-hidden="true" />
          </Button>
        {/snippet}
        <DataTable
          variant="plain"
          data={pickedTypes}
          columns={visibleSvcColumns}
          getRowId={(et) => et.id}
          cells={{ title: titleCell, duration: durationCell, price: priceCell }}
          rowActions={svcRowActions}
          rowActionsMode="always"
        />
      {:else}
        <p class="t-caption svc-empty">{m.appt_services_empty()}</p>
      {/if}
      <div class="svc-add-row">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-haspopup="dialog"
          onclick={() => (servicePickerOpen = true)}
        >
          <Plus size={iconSizes.sm} aria-hidden="true" />
          {m.appt_add_service()}
        </Button>
      </div>
    </div>
    {#if picked.length > 1}
      <p class="t-caption svc-summary">
        {m.appt_visit_summary({ count: String(picked.length), minutes: String(totalMinutes) })}
      </p>
    {/if}
  </div>

  <!-- Team stays a "primitive picker combobox" (owner 2026-09-17): type to
       filter, or open the Picker from the icon. Its rows are already the
       service's assignees (teamOptions), so every path respects that filter. -->
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

  {#if slotsLoading && !slots.length}
    <p class="t-caption">…</p>
  {:else if slotError}
    <div class="slot-error" role="alert">
      <p class="t-caption danger">{slotError}</p>
      <Button variant="outline" size="sm" onclick={loadSlots}>{m.common_retry()}</Button>
    </div>
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

  {#if err}<p class="t-caption danger" role="alert">{err}</p>{/if}

  <div class="actions">
    <Button
      onclick={book}
      loading={submitting}
      disabled={submitDisabled}
      title={canBook ? undefined : m.no_permission()}
    >
      {m.sched_book_confirm()}
    </Button>
    <Button variant="ghost" disabled={submitting} onclick={oncancel}>{m.sched_cancel()}</Button>
  </div>
</div>

<Picker
  bind:open={servicePickerOpen}
  title={m.sched_book_choose_service()}
  columns={svcColumns}
  rows={eventTypes}
  getRowId={(e) => e.id}
  searchText={(e) => e.title}
  onPick={pickService}
  onUnpick={unpickService}
  selectionMode={multiService ? 'multiple' : 'single'}
  duplicatePolicy="prevent"
  {pickedIds}
  searchPlaceholder={m.sched_book_choose_service()}
  emptyLabel={m.sched_empty_eventTypes()}
  storageKey="sched-service"
/>

<style>
  .appt-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 44rem;
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
  .svc-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .svc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .svc-kebab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .svc-kebab:hover {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }
  .svc-table {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .svc-empty {
    padding: var(--space-3);
  }
  .svc-add-row {
    display: flex;
    border-top: 1px solid var(--color-border-subtle);
    padding: var(--space-1) var(--space-2);
  }
  .svc-summary {
    text-align: right;
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--space-2);
    max-height: 13rem;
    overflow: auto;
  }
  .slot-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
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
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
