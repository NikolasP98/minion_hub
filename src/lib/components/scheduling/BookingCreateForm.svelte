<script lang="ts">
  /**
   * In-page "New appointment" form (`/scheduling/bookings/new`). Extracted from
   * the BookingsView modal so the assistant can guide/fill it on a real route and
   * the customer picker (a top-layer Picker window) never fights a dialog.
   */
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { Button, Select } from '$lib/components/ui';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { formatTime } from '$lib/utils/format';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import ServicePickerField from '$lib/components/scheduling/ServicePickerField.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import type { PartyOption } from '$lib/components/crm/party-picker';
  import type { CalKind, CalTag } from '$lib/components/scheduling/calendar/types';
  import { canAct } from '$lib/access/can.svelte';
  import { registerForm } from '$lib/assistant/forms';
  import { fuzzyFind } from '$lib/assistant/fuzzy';
  import { BOOKING_FORM } from '$lib/assistant/catalog';
  import { tryUseActions } from '$lib/services/actions/context';
  import { todayIn } from './calendar-window';
  import { schedulingSlotWindow } from './calendar-time';
  import {
    requireOk,
    runCompoundMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';

  export type BookingEventType = {
    id: string;
    title: string;
    productId: string | null;
    active?: boolean;
    length?: number;
    kindId: string | null;
  };
  export type BookingContactPrefill = {
    id: string;
    partyId: string | null;
    name: string | null;
    phone: string | null;
  };

  let {
    eventTypes,
    kinds = [],
    tags = [],
    contact = null,
    returnTo = '/scheduling/bookings',
    timeZone,
    mutationScope,
  }: {
    eventTypes: BookingEventType[];
    /** Org-defined event kinds (`sched_event_kinds`) — the calendar category. */
    kinds?: CalKind[];
    /** Org-wide manual tags, for the booking's own tag picker. */
    tags?: CalTag[];
    /** `?contact=` deep link: the customer is pre-picked and the booking keeps that CRM link. */
    contact?: BookingContactPrefill | null;
    returnTo?: string;
    timeZone: string;
    mutationScope: string;
  } = $props();

  // Calendar drag-select deep link: `/scheduling/bookings/new?date=&time=&resource=`
  // (SchedulingCalendar's `select` handler). `time`/`resource` are applied once,
  // after the user picks a service and its slots load (below) — the calendar
  // link never carries a service, so slots can't resolve any earlier than that.
  const dateParam = page.url.searchParams.get('date');
  let prefillTime = page.url.searchParams.get('time');
  let eventTypeId = $state('');
  let date = $state(
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : untrack(() => todayIn(timeZone)),
  );
  let slots = $state<Array<{ start: string; end: string; resourceIds?: string[] }>>([]);
  let slot = $state('');
  // svelte-ignore state_referenced_locally
  let resourceId = $state(page.url.searchParams.get('resource') ?? '');
  let slotsLoading = $state(false);
  let submitting = $state(false);
  let submitCommitted = $state(false);
  let err = $state<string | null>(null);
  let slotError = $state<string | null>(null);
  let slotScope = $state<{ mutationScope: string; timeZone: string } | null>(null);
  let slotsGeneration = 0;
  let temporalScopeKey = '';
  $effect(() => {
    const next = `${mutationScope}|${timeZone}`;
    if (next === temporalScopeKey) return;
    const firstScope = temporalScopeKey === '';
    temporalScopeKey = next;
    untrack(() => {
      slotsGeneration += 1;
      slots = [];
      slot = '';
      slotScope = null;
      slotError = null;
      err = null;
      if (!firstScope) {
        prefillTime = null;
        resourceId = '';
        if (!dateParam) date = todayIn(timeZone);
      }
      if (eventTypeId) void loadSlots();
    });
  });
  const actions = tryUseActions();
  let tagRepair = $state<{ bookingId: string; tagIds: string[] } | null>(null);
  let primaryUnknown = $state(false);
  let repairScopeVersion = actions?.scopeVersion;

  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === repairScopeVersion) return;
    repairScopeVersion = scopeVersion;
    tagRepair = null;
    primaryUnknown = false;
    submitCommitted = false;
    err = null;
  });

  let repairTemporalScope = '';
  $effect(() => {
    const next = `${mutationScope}\u0000${timeZone}`;
    if (next === repairTemporalScope) return;
    const firstScope = repairTemporalScope === '';
    repairTemporalScope = next;
    if (firstScope) return;
    tagRepair = null;
    primaryUnknown = false;
    submitCommitted = false;
    err = null;
  });

  const orgDefaultKindId = $derived(kinds.find((k) => k.isDefault)?.id ?? '');
  let kindId = $state('');
  let kindTouched = $state(false);
  let tagIds = $state<string[]>([]);
  // Defaults to the picked service's kind, falling back to the org default —
  // recomputed only until the user overrides it explicitly.
  $effect(() => {
    if (kindTouched) return;
    const et = eventTypes.find((e) => e.id === eventTypeId);
    kindId = et?.kindId ?? orgDefaultKindId;
  });

  // svelte-ignore state_referenced_locally -- seed from the deep link once
  let partyId = $state<string | null>(contact?.partyId ?? null);
  // svelte-ignore state_referenced_locally
  let customerName = $state<string | null>(contact?.name ?? null);
  // svelte-ignore state_referenced_locally
  let phone = $state<string | null>(contact?.phone ?? null);
  let customerPicker = $state<ReturnType<typeof CustomerPicker>>();
  // Keep the deep-linked contact id only while that contact is still the customer.
  const crmContactId = $derived(
    contact && customerName === contact.name && partyId === contact.partyId ? contact.id : null,
  );

  async function loadSlots() {
    if (!eventTypeId || !date) return;
    const token = ++slotsGeneration;
    const requestScope = { mutationScope, timeZone };
    slotsLoading = true;
    if (!submitting && !primaryUnknown && !submitCommitted) err = null;
    slotError = null;
    slot = '';
    slotScope = null;
    const window = schedulingSlotWindow(date, requestScope.timeZone);
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
    try {
      const res = await fetch(
        `/api/scheduling/slots?eventTypeId=${eventTypeId}&from=${window.from.toISOString()}&to=${window.to.toISOString()}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextSlots = ((await res.json()).slots ?? []) as typeof slots;
      if (
        token !== slotsGeneration ||
        requestScope.mutationScope !== mutationScope ||
        requestScope.timeZone !== timeZone
      )
        return;
      slots = nextSlots;
      slotScope = requestScope;
      if (prefillTime) {
        const want = prefillTime;
        const hit = slots.find(
          (s) =>
            hhmm(s.start) === want && (!resourceId || (s.resourceIds ?? []).includes(resourceId)),
        );
        if (hit) slot = hit.start;
        prefillTime = null; // apply once only
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

  const hhmm = (iso: string) => formatTime(iso, timeZone);

  // ── Assistant fill (never submits) ──
  $effect(() =>
    registerForm({
      def: BOOKING_FORM,
      get: () => ({
        service: eventTypeId,
        date,
        time: slot ? hhmm(slot) : '',
        client: customerName ?? '',
        phone: phone ?? '',
      }),
      set: async (v) => {
        const filled: string[] = [];
        const rejected: Array<{ key: string; reason: string }> = [];
        const notes: string[] = [];
        const matched = (typed: string, label: string) => {
          if (typed.trim().toLowerCase() !== label.trim().toLowerCase())
            notes.push(`matched "${typed}" → "${label}"`);
        };
        if (typeof v.service === 'string' && v.service.trim()) {
          const { match: et, candidates } = fuzzyFind(v.service, eventTypes, (e) => [e.title]);
          if (et) {
            eventTypeId = et.id;
            filled.push('service');
            matched(v.service, et.title);
          } else {
            rejected.push({
              key: 'service',
              reason: `no service matches "${v.service}"; did you mean: ${candidates.map((e) => e.title).join(', ') || 'none'}`,
            });
          }
        }
        if (typeof v.date === 'string' && v.date) {
          date = v.date;
          filled.push('date');
        }
        if (filled.includes('service') || filled.includes('date')) await loadSlots();
        if (typeof v.time === 'string' && v.time.trim()) {
          const mm = /^(\d{1,2}):(\d{2})/.exec(v.time.trim());
          const want = mm ? `${mm[1].padStart(2, '0')}:${mm[2]}` : v.time.trim();
          const hit = eventTypeId ? slots.find((s) => hhmm(s.start) === want) : undefined;
          if (hit) {
            slot = hit.start;
            filled.push('time');
          } else {
            rejected.push({
              key: 'time',
              reason: !eventTypeId
                ? 'pick a service first'
                : slots.length
                  ? `no free slot at ${want}; free: ${slots.map((s) => hhmm(s.start)).join(', ')}`
                  : 'no free slots on that date',
            });
          }
        }
        if (typeof v.client === 'string' && v.client.trim()) {
          const q = v.client.trim();
          let found: PartyOption[] = [];
          try {
            const res = await fetch(`/api/crm/parties?q=${encodeURIComponent(q)}&type=person`);
            found = res.ok ? ((await res.json()) as PartyOption[]) : [];
          } catch {
            /* search is best-effort; falls through to "no match" */
          }
          const { match, candidates } = fuzzyFind(q, found, (p) => [p.name, p.docNumber, p.phone9]);
          if (match) {
            customerPicker?.pick(match);
            filled.push('client');
            matched(q, match.name ?? '');
          } else if (typeof v.newClientName === 'string' && v.newClientName.trim()) {
            await customerPicker?.add(v.newClientName, typeof v.phone === 'string' ? v.phone : '');
            filled.push('client', 'newClientName');
          } else {
            rejected.push({
              key: 'client',
              reason: `no client matches "${q}"; did you mean: ${candidates.map((p) => p.name ?? p.docNumber ?? '—').join(', ') || 'none'}. To register a new client pass newClientName (and phone).`,
            });
          }
        } else if (typeof v.newClientName === 'string' && v.newClientName.trim()) {
          await customerPicker?.add(v.newClientName, typeof v.phone === 'string' ? v.phone : '');
          filled.push('newClientName');
        }
        if (typeof v.phone === 'string' && v.phone.trim() && !filled.includes('newClientName')) {
          phone = v.phone.trim();
          filled.push('phone');
        }
        return { filled, rejected, note: notes.join('; ') || undefined };
      },
    }),
  );

  async function book() {
    if (slotsLoading || submitting || primaryUnknown || submitCommitted) return;
    if (!eventTypeId || !slot || !customerName?.trim()) {
      err = 'service, time and client required';
      return;
    }
    if (
      !slotScope ||
      slotScope.mutationScope !== mutationScope ||
      slotScope.timeZone !== timeZone
    ) {
      err = m.cal_gesture_scope_changed();
      return;
    }
    submitting = true;
    err = null;
    const repair = tagRepair;
    const tagSnapshot = repair?.tagIds ?? [...tagIds];
    const scopeVersion = actions?.scopeVersion;
    const requestScope = { mutationScope, timeZone };
    const requestReturnTo = returnTo;
    const primarySnapshot = {
      eventTypeId,
      start: slot,
      attendeeName: customerName,
      attendeePhone: phone || null,
      crmContactId,
      partyId,
      kindId: kindId || null,
      // TODO(handoff): resourceId is only ever set from the calendar's
      // ?resource= deep link — there's no visible staff picker in this
      // form, so it can't be changed or cleared by hand. It's sent as a
      // "preferred resource" hint on every submit, including a manually
      // re-picked slot at an unrelated time; the backend just tries that
      // resource and 409s (refreshing slots) if it's unavailable, so this
      // is safe but can surprise a user who ignores the pre-filled time.
      // Add a small "booking for <staff>" chip (need a `resources` list
      // prop wired from bookings/new/+page.server.ts) if this bites.
      resourceId: resourceId || undefined,
    };
    const requestIsCurrent = () =>
      requestScope.mutationScope === mutationScope &&
      requestScope.timeZone === timeZone &&
      (!actions || actions.scopeVersion === scopeVersion);
    try {
      const outcome = await runTrackedCommand(actions, 'scheduling.booking.create', (context) =>
        runCompoundMutation({
          context,
          committed: repair?.bookingId,
          primaryAttemptId: 'scheduling.booking.create.primary',
          primary: async (signal) => {
            const response = await fetch('/api/scheduling/bookings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(primarySnapshot),
              signal,
            });
            await requireOk(response, m.sched_book_unavailable());
            return ((await response.json()) as { booking: { id: string } }).booking.id;
          },
          followupAttemptId: 'scheduling.booking.create.tags',
          followup: async (bookingId, signal) => {
            if (!tagSnapshot.length) return;
            const response = await fetch(`/api/tags/booking/${bookingId}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tagIds: tagSnapshot }),
              signal,
            });
            await requireOk(response, m.data_table_bulk_tags_failed());
          },
          onPrimaryCommitted: (bookingId) => {
            if (requestIsCurrent()) tagRepair = { bookingId, tagIds: tagSnapshot };
          },
          onFollowupCommitted: () => {
            if (requestIsCurrent()) {
              tagRepair = null;
              primaryUnknown = false;
              submitCommitted = true;
            }
          },
          refresh: async () => {
            if (!requestIsCurrent()) return;
            await goto(requestReturnTo);
          },
          refreshAttemptId: 'scheduling.booking.create.navigate',
        }),
      );
      if (!requestIsCurrent()) return;
      if (outcome.status === 'succeeded') return;
      if (outcome.status === 'committed-refreshing') {
        submitCommitted = true;
        err = m.asyncAction_refreshing();
        return;
      }
      if (outcome.status === 'partial') {
        err = m.asyncAction_partial();
        return;
      }
      if (outcome.status === 'unknown') {
        if (!tagRepair) primaryUnknown = true;
        err = m.asyncAction_unknown();
        return;
      }
      if (outcome.status === 'conflict') await loadSlots();
      err = outcome.error instanceof Error ? outcome.error.message : m.sched_book_unavailable();
    } catch (e) {
      if (requestIsCurrent()) err = e instanceof Error ? e.message : 'error';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="booking-form">
  <div class="top">
    <div class="field">
      <span class="t-caption">{m.sched_book_choose_service()}</span>
      <div data-assist="booking.service">
        <ServicePickerField services={eventTypes} bind:value={eventTypeId} onchange={loadSlots} />
      </div>
    </div>
    <label class="field">
      <span class="t-caption">{m.sched_book_pick_time()}</span>
      <input
        class="txt"
        type="date"
        data-assist="booking.date"
        bind:value={date}
        onchange={loadSlots}
      />
    </label>
  </div>
  {#if slotsLoading}
    <p class="t-caption">{m.sched_book_loading()}</p>
  {:else if slotError}
    <div class="slot-error" role="alert">
      <p class="t-caption danger">{slotError}</p>
      <Button variant="outline" size="sm" onclick={loadSlots}>{m.common_retry()}</Button>
    </div>
  {:else if eventTypeId && slots.length === 0}
    <p class="t-caption">{m.sched_book_no_slots()}</p>
  {:else if slots.length}
    <div class="slot-grid" data-assist="booking.time">
      {#each slots as s (s.start)}
        <Button
          variant="outline"
          size="sm"
          type="button"
          class="slot {slot === s.start ? 'slot-on' : ''}"
          aria-pressed={slot === s.start}
          onclick={() => (slot = s.start)}
        >
          {formatTime(s.start, timeZone)}
        </Button>
      {/each}
    </div>
  {/if}
  <div data-assist="booking.client">
    <CustomerPicker
      bind:this={customerPicker}
      bind:partyId
      bind:customerName
      bind:phone
      required
      label={m.sched_book_find_client()}
    />
  </div>
  {#if kinds.length > 0}
    <label class="field">
      <span class="t-caption">{m.sched_kind_label()}</span>
      <Select
        value={kindId}
        onchange={(v) => {
          kindId = String(v);
          kindTouched = true;
        }}
      >
        {#each kinds as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
      </Select>
    </label>
  {/if}
  <div class="field">
    <span class="t-caption">{m.tags_label()}</span>
    <TagsField scope="event" allTags={tags} bind:value={tagIds} disabled={!!tagRepair} />
  </div>
  {#if err}<p class="t-caption danger" role="alert">{err}</p>{/if}
  <div class="actions">
    <Button
      data-assist="booking.submit"
      onclick={book}
      loading={submitting}
      disabled={slotsLoading ||
        submitting ||
        submitCommitted ||
        primaryUnknown ||
        !slot ||
        !customerName?.trim() ||
        !canAct('scheduling', 'edit')}
      title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
      >{tagRepair ? m.asyncAction_retry() : m.sched_book_confirm()}</Button
    >
    <Button variant="ghost" href={returnTo} disabled={submitting}>{m.sched_cancel()}</Button>
  </div>
</div>

<style>
  .booking-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .slot-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .txt {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    width: 100%;
  }
  .booking-form :global(.slot-on) {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .top {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  @media (min-width: 768px) {
    .top {
      grid-template-columns: 1fr 1fr;
    }
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: var(--space-2);
    max-height: 12.5rem;
    overflow: auto;
  }
  .danger {
    color: var(--color-danger-fg);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
