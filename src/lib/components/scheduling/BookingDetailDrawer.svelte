<script lang="ts">
  /**
   * Booking detail drawer (spec `2026-09-13-pos-scheduling-packages-payment-plans`
   * §4.1) — the scheduling module's first event-detail surface. Opened from the
   * calendar grid and from `BookingsView` rows; reads
   * `GET /api/scheduling/bookings/[id]` (the S3 `getBookingDetail` payload) and
   * writes through `PATCH …/[id]` (status) and `PUT …/[id]/notes`.
   *
   * Built on the `Sheet` foundation (native `<dialog showModal>`): backdrop
   * pointerdown + Escape dismissal come from the primitive, never hand-rolled.
   */
  import {
    ArrowRight,
    Ban,
    Check,
    ExternalLink,
    Pencil,
    ShoppingCart,
    UserX,
    X,
  } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    SegmentedControl,
    Select,
    Spinner,
    iconSizes,
  } from '$lib/components/ui';
  import { Sheet } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney, formatTime } from '$lib/utils/format';
  import { canAct } from '$lib/access/can.svelte';
  import ConsumptionConfirmDialog from './ConsumptionConfirmDialog.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';

  /**
   * The serialized shape of `BookingDetail` — a client component must not import
   * from `$server`, and `json()` turns every Date into an ISO string. Narrowed to
   * what this surface actually renders.
   */
  type Detail = {
    booking: {
      id: string;
      status: string;
      title: string | null;
      eventTypeId: string;
      resourceId: string;
      productId: string | null;
      partyId: string | null;
      startTime: string;
      endTime: string;
      attendeeName: string | null;
      attendeeEmail: string | null;
      attendeePhone: string | null;
      crmContactId: string | null;
      notes: string | null;
      clientNote: string | null;
    };
    eventType: { id: string; title: string } | null;
    resource: { id: string; name: string } | null;
    contact: { id: string; displayName: string | null; partyId: string | null } | null;
    statusHistory: Array<{
      id: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      changedAt: string;
      changedByName: string | null;
    }>;
    grant: {
      grant: {
        id: string;
        sessionsTotal: number;
        unitValue: string;
        expiresAt: string | null;
      };
      sessionsUsed: number;
      sessionsRemaining: number;
      status: string;
      packageName: string | null;
    } | null;
    plan: {
      plan: { id: string; title: string; totalAmount: string; currency: string; status: string };
      paidToDate: number;
      remaining: number;
      isPaid: boolean;
      nextDue: { dueOn: string; amount: number } | null;
    } | null;
    series: {
      seriesId: string;
      index: number | null;
      total: number;
      occurrences: Array<{
        id: string;
        seriesIndex: number | null;
        startTime: string;
        endTime: string;
        status: string;
      }>;
    } | null;
    accrual: {
      open: number;
      realized: number;
      released: number;
      estValue: number;
      realizedValue: number;
      realizedEntryId: string | null;
    } | null;
    tickets: Array<{
      ticketId: string;
      humanId: string | null;
      submittedAt: string | null;
      status: string;
      currency: string;
      lineTotal: string;
    }>;
    tags: { own: CalTag[]; contact: CalTag[]; service: CalTag[] };
  };

  /** What the POS charge handoff needs to prefill a cart. */
  export type PayableBooking = Pick<
    Detail['booking'],
    'id' | 'eventTypeId' | 'productId' | 'partyId' | 'attendeeName' | 'attendeePhone'
  >;

  type Props = {
    /** Non-null opens the drawer and triggers the fetch. */
    bookingId: string | null;
    /** Parent clears its `bookingId`. */
    onclose: () => void;
    /** Fired after any mutation so the host can `invalidate()` its list. */
    onchanged?: () => void | Promise<void>;
    /** Jump to a sibling occurrence without closing the drawer. */
    onnavigate?: (id: string) => void;
    /** Team members offered by the reschedule form; omit to edit date/time only. */
    resources?: { id: string; name: string }[];
    /** "Take payment": the host owns the POS checkout handoff. Omit to hide it.
     *  `planId` is set when the treatment already has an instalment plan, so the
     *  till charges the next instalment instead of the full price. */
    onpay?: (booking: PayableBooking, planId?: string | null) => void;
    /** Detail/patch endpoint base — the POS calendar passes `/api/pos/appointments`
     *  so its own capabilities gate the drawer (default: scheduling). */
    apiBase?: string;
    /** Overrides the default `scheduling:edit` gate on every mutation. */
    canEdit?: boolean;
  };

  let {
    bookingId,
    onclose,
    onchanged,
    onnavigate,
    resources,
    onpay,
    apiBase = '/api/scheduling/bookings',
    canEdit: canEditProp,
  }: Props = $props();

  let detail = $state<Detail | null>(null);
  let loading = $state(false);
  let err = $state<string | null>(null);
  let busy = $state(false);

  // Notes are seeded once per loaded booking (an editable field must not be a
  // $derived read-through — that wipes the user's typing on every re-render).
  let internalNote = $state('');
  let clientNote = $state('');
  let notesSaved = $state(false);

  // Reschedule (date / start time / team member), inline. Duration is kept.
  // Customer and procedure are deliberately NOT editable here (owner rule).
  let editOpen = $state(false);
  let editDay = $state('');
  let editTime = $state('');
  let editResource = $state('');

  // "Mark completed" → confirm the consumed stock first (owner 2026-09-25).
  let completeOpen = $state(false);

  // Cancel confirmation, inline inside the drawer.
  let cancelOpen = $state(false);
  let cancelReason = $state('');
  let cancelScope = $state<'one' | 'following'>('one');

  let gen = 0;
  $effect(() => {
    const id = bookingId;
    const token = ++gen;
    if (!id) {
      detail = null;
      err = null;
      return;
    }
    loading = true;
    err = null;
    editOpen = false;
    cancelOpen = false;
    completeOpen = false;
    cancelReason = '';
    cancelScope = 'one';
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/${id}`);
        if (token !== gen) return; // a newer open superseded this fetch
        if (!res.ok) throw new Error(String(res.status));
        const d: Detail = await res.json();
        detail = d;
        // Event-scope registry for the tag picker — once per open, never blocking the detail.
        if (eventTags === null && canEdit) {
          void fetch('/api/tags?scope=event')
            .then((r) => (r.ok ? r.json() : { tags: [] }))
            .then((j: { tags: CalTag[] }) => (eventTags = j.tags))
            .catch(() => (eventTags = []));
        }
        internalNote = d.booking.notes ?? '';
        clientNote = d.booking.clientNote ?? '';
        notesSaved = false;
      } catch (e) {
        if (token !== gen) return;
        detail = null;
        err = e instanceof Error ? e.message : 'error';
      } finally {
        if (token === gen) loading = false;
      }
    })();
  });

  let eventTags = $state<CalTag[] | null>(null);
  async function saveTags(ids: string[]) {
    if (!detail) return;
    const res = await fetch(`/api/tags/booking/${detail.booking.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: ids }),
    });
    if (res.ok) {
      const { tags } = (await res.json()) as { tags: CalTag[] };
      detail = { ...detail, tags: { ...detail.tags, own: tags } };
      await onchanged?.();
    }
  }

  const STATUS_LABEL: Record<string, () => string> = {
    accepted: () => m.sched_status_accepted(),
    pending: () => m.sched_status_pending(),
    cancelled: () => m.sched_status_cancelled(),
    rejected: () => m.sched_status_rejected(),
    completed: () => m.sched_status_completed(),
    no_show: () => m.sched_status_no_show(),
  };
  const statusLabel = (s: string) => (STATUS_LABEL[s] ?? (() => s))();

  /** One fixed semantic ramp — the same hue on every surface (governance §ramp),
   *  identical to the calendar's legend: pending amber, confirmed blue,
   *  completed green, rejected and no-show red, cancelled neutral. */
  const STATUS_TONE: Record<string, 'success' | 'error' | 'warning' | 'info' | null> = {
    completed: 'success',
    cancelled: null,
    rejected: 'error',
    no_show: 'error',
    pending: 'warning',
    accepted: 'info',
  };
  /** `Badge` props for a status: the semantic tone, or the neutral variant. */
  const statusBadge = (s: string) => {
    const tone = STATUS_TONE[s];
    return tone
      ? ({ variant: 'semantic', value: tone } as const)
      : ({ variant: 'neutral' } as const);
  };

  // TODO(handoff): the drawer still shows no LINKED POS TICKETS — spec §4.1
  // lists them, but `getBookingDetail` carries no ticket→booking join. The
  // other three §15 gaps (actor name, next instalment, package name) are closed.
  // See proposals/2026-09-13-pos-packages-plans-s1-followups.md §15.
  // TODO(handoff): spec §4.1 also lists reschedule, "charge in POS" and "book the
  // next session from the remaining grant" as drawer actions. Complete / no-show /
  // cancel and "pay in instalments" (the plan form below) are wired; the other
  // three need POS surfaces this slice must not touch. Same proposal §16.
  // TODO(handoff): the plan button is gated on `pos:create`, but server-side
  // `apiWriteCapability` resolves POST /api/pos/plans to `pos:edit` (the path is
  // not in CREATE_COLLECTION_ENDPOINTS, rbac.service.ts). Every default role
  // preset grants the two together, so only a hand-made org override can split
  // them — such a role would see the button and get a 403. Fix by listing
  // '/api/pos/plans' in CREATE_COLLECTION_ENDPOINTS. Same proposal §16.
  // Locale-pinned, 24-hour: `toLocaleString(undefined, …)` asked the BROWSER and
  // printed "Sep 15, 2026, 9:00 AM" inside an otherwise Spanish drawer.
  const fmtDateTime = (iso: string) =>
    formatDate(iso, { dateStyle: 'medium', timeStyle: 'short', hour12: false });
  const fmtTime = (iso: string) => formatTime(iso);

  const isLive = $derived(
    detail?.booking.status === 'accepted' || detail?.booking.status === 'pending',
  );
  const canEdit = $derived(canEditProp ?? canAct('scheduling', 'edit'));

  /** Re-read after any mutation: status history, the grant's sessionsRemaining
   *  and the accrual rollup all move server-side on a status change. */
  async function reloadDetail() {
    if (!bookingId) return;
    const again = await fetch(`${apiBase}/${bookingId}`);
    if (again.ok) detail = await again.json();
    await onchanged?.();
  }

  async function patchStatus(status: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return;
    busy = true;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${bookingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (j?.stockWarning) err = j.stockWarning.message as string;
      cancelOpen = false;
      await reloadDetail();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  function openEdit() {
    if (!detail) return;
    const s = new Date(detail.booking.startTime);
    editDay = `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
    editTime = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
    editResource = detail.booking.resourceId;
    editOpen = true;
  }
  async function applyEdit() {
    if (!bookingId || !detail) return;
    const start = new Date(`${editDay}T${editTime}:00`);
    if (Number.isNaN(start.getTime())) return;
    const duration =
      new Date(detail.booking.endTime).getTime() - new Date(detail.booking.startTime).getTime();
    busy = true;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${bookingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          start: start.toISOString(),
          end: new Date(start.getTime() + duration).toISOString(),
          resourceId: editResource || detail.booking.resourceId,
        }),
      });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        err = (j.message as string | undefined) ?? m.sched_detail_conflict();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      editOpen = false;
      const again = await fetch(`${apiBase}/${bookingId}`);
      if (again.ok) detail = await again.json();
      await onchanged?.();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }

  /** A charge makes sense for anything that will (or did) happen and is not
   *  funded by a session package. A treatment on an instalment plan still
   *  takes money — the next instalment — until the plan is paid off. Whether
   *  a payment is direct or in parts is decided at the till (`/pos/sell?step=pay`),
   *  never here. */
  const payOfferable = $derived(
    detail !== null &&
      detail.grant === null &&
      (detail.plan === null || !detail.plan.isPaid) &&
      !['cancelled', 'rejected', 'no_show'].includes(detail.booking.status),
  );

  async function saveNotes() {
    if (!bookingId) return;
    busy = true;
    err = null;
    notesSaved = false;
    try {
      const res = await fetch(`${apiBase}/${bookingId}/notes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: internalNote || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      notesSaved = true;
      await onchanged?.();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }
</script>

<Sheet
  open={bookingId !== null}
  title={m.sched_detail_title()}
  size="lg"
  placement="right"
  {onclose}
>
  {#if loading}
    <div class="center"><Spinner /></div>
  {:else if !detail}
    <EmptyState title={err ?? m.sched_detail_not_found()} />
  {:else}
    {@const d = detail}
    <div class="drawer">
      <!-- Identity: what, who for, when, where -->
      <section class="blk">
        <div class="head-row">
          <h3 class="t-title">{d.eventType?.title ?? d.booking.title ?? '—'}</h3>
          <Badge {...statusBadge(d.booking.status)}>
            {statusLabel(d.booking.status)}
          </Badge>
        </div>
        <dl class="facts">
          <dt class="t-caption">{m.sched_booking_when()}</dt>
          <dd>{fmtDateTime(d.booking.startTime)} – {fmtTime(d.booking.endTime)}</dd>
          <dt class="t-caption">{m.sched_booking_who()}</dt>
          <dd>{d.resource?.name ?? '—'}</dd>
          <dt class="t-caption">{m.sched_booking_attendee()}</dt>
          <dd>
            {d.contact?.displayName ?? d.booking.attendeeName ?? '—'}
            {#if d.booking.attendeePhone}<span class="t-caption">
                · {d.booking.attendeePhone}</span
              >{/if}
            {#if d.booking.attendeeEmail}<span class="t-caption">
                · {d.booking.attendeeEmail}</span
              >{/if}
            {#if d.booking.crmContactId}
              <a class="crm-link t-caption" href={`/crm/${d.booking.crmContactId}`}>
                <ExternalLink size={iconSizes.xs} />{m.sched_detail_open_contact()}
              </a>
            {/if}
          </dd>
        </dl>
        {#if isLive && canEdit}
          {#if editOpen}
            <div class="edit-box">
              <div class="row">
                <label class="fld">
                  <span class="t-caption">{m.sched_detail_edit_date()}</span>
                  <input class="txt" type="date" bind:value={editDay} />
                </label>
                <label class="fld">
                  <span class="t-caption">{m.sched_detail_edit_time()}</span>
                  <input class="txt" type="time" step="900" bind:value={editTime} />
                </label>
              </div>
              {#if resources?.length}
                <Select
                  size="sm"
                  label={m.sched_booking_who()}
                  options={resources.map((r) => ({ value: r.id, label: r.name }))}
                  value={editResource}
                  onchange={(v) => (editResource = String(v))}
                />
              {/if}
              <div class="row">
                <Button size="sm" disabled={busy} onclick={applyEdit}>{m.sched_save()}</Button>
                <Button size="sm" variant="ghost" onclick={() => (editOpen = false)}
                  >{m.sched_cancel()}</Button
                >
              </div>
            </div>
          {:else}
            <div class="row">
              <Button size="sm" variant="ghost" disabled={busy} onclick={openEdit}>
                <Pencil size={iconSizes.sm} />{m.sched_detail_reschedule()}
              </Button>
            </div>
          {/if}
        {/if}
      </section>

      <!-- Tags: own event tags (editable) + the client's and service's (inherited, read-only) -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_tags()}</h4>
        <TagsField
          scope="event"
          allTags={eventTags ?? d.tags.own}
          value={d.tags.own.map((t) => t.id)}
          onchange={saveTags}
          disabled={!canEdit}
        />
        {#if d.tags.contact.length || d.tags.service.length}
          <div class="row wrap">
            {#each d.tags.contact as t ('c:' + t.id)}
              <TagChip size="sm" name={t.name} color={t.color} dashed origin="contact" />
            {/each}
            {#each d.tags.service as t ('s:' + t.id)}
              <TagChip size="sm" name={t.name} color={t.color} dashed origin="product" />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Payment: ONE section for whatever the agreement is — the tickets that
           charged this booking, the package it draws on, the instalment plan it
           pays off — and the single verb, which hands off to the till. Direct vs
           in parts is chosen there (`/pos/sell?step=pay`), not here. -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_payment()}</h4>
        {#if d.tickets.length > 0}
          <div class="row wrap">
            {#each d.tickets as t (t.ticketId)}
              <Badge variant="semantic" value={t.status === 'voided' ? 'error' : 'success'}>
                {t.status === 'voided'
                  ? m.sched_detail_ticket_voided()
                  : m.sched_detail_paid({ value: formatMoney(t.lineTotal, t.currency) })}
              </Badge>
              <span class="t-caption">
                #{t.humanId ?? t.ticketId.slice(0, 8)}{t.submittedAt
                  ? ` · ${fmtDateTime(t.submittedAt)}`
                  : ''}
              </span>
            {/each}
          </div>
        {/if}
        {#if d.grant}
          <div class="row wrap">
            <span class="t-caption">{m.sched_detail_covered_package()}</span>
            {#if d.grant.packageName}<span>{d.grant.packageName}</span>{/if}
            <Badge variant="semantic" value={d.grant.sessionsRemaining > 0 ? 'info' : 'warning'}>
              {m.sched_detail_package_sessions({
                remaining: String(d.grant.sessionsRemaining),
                total: String(d.grant.grant.sessionsTotal),
              })}
            </Badge>
            <span class="t-caption">
              {d.grant.grant.expiresAt
                ? m.sched_detail_package_expires({ date: d.grant.grant.expiresAt })
                : m.sched_detail_package_no_expiry()}
            </span>
            <span class="t-caption">
              {m.sched_detail_package_unit_value({
                value: formatMoney(d.grant.grant.unitValue),
              })}
            </span>
          </div>
        {:else if d.plan}
          <div class="row wrap">
            <span>{d.plan.plan.title}</span>
            <Badge variant="semantic" value={d.plan.isPaid ? 'success' : 'warning'}>
              {m.sched_detail_plan_paid({
                paid: formatMoney(d.plan.paidToDate, d.plan.plan.currency),
                total: formatMoney(d.plan.plan.totalAmount, d.plan.plan.currency),
              })}
            </Badge>
            <span class="t-caption">
              {m.sched_detail_plan_remaining({
                value: formatMoney(d.plan.remaining, d.plan.plan.currency),
              })}
            </span>
            {#if d.plan.nextDue}
              <span class="t-caption">
                {m.sched_detail_plan_next_due({
                  date: d.plan.nextDue.dueOn,
                  value: formatMoney(d.plan.nextDue.amount, d.plan.plan.currency),
                })}
              </span>
            {/if}
          </div>
        {:else if d.tickets.length === 0}
          <span class="t-caption">{m.sched_detail_unpaid()}</span>
        {/if}
        {#if onpay && payOfferable && !d.tickets.some((t) => t.status !== 'voided')}
          <div class="row">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canAct('pos', 'create')}
              title={canAct('pos', 'create') ? undefined : m.no_permission()}
              onclick={() =>
                onpay(
                  // Older bookings remember only their contact — hand the till
                  // the contact's party so the client is not a ticket-only name.
                  { ...d.booking, partyId: d.booking.partyId ?? d.contact?.partyId ?? null },
                  d.plan?.plan.id ?? null,
                )}
            >
              <ShoppingCart size={iconSizes.sm} />{d.plan
                ? m.sched_detail_take_instalment()
                : m.sched_detail_take_payment()}
            </Button>
          </div>
        {/if}
      </section>

      <!-- Stock accrual rollup -->
      {#if d.accrual && (d.accrual.open || d.accrual.realized || d.accrual.released)}
        <section class="blk">
          <h4 class="t-label">{m.sched_detail_stock()}</h4>
          <div class="row">
            {#if d.accrual.open > 0}
              <Badge variant="semantic" value="warning"
                >{m.sched_stock_committed({ value: formatMoney(d.accrual.estValue) })}</Badge
              >
            {/if}
            {#if d.accrual.realized > 0}
              <a
                class="crm-link"
                href={d.accrual.realizedEntryId
                  ? `/stock/entries/${d.accrual.realizedEntryId}`
                  : '/stock'}
              >
                <Badge variant="semantic" value="success"
                  >{m.sched_stock_realized({ value: formatMoney(d.accrual.realizedValue) })}</Badge
                >
              </a>
            {/if}
            {#if d.accrual.released > 0}
              <Badge>{m.sched_stock_released()}</Badge>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Series siblings -->
      {#if d.series}
        <section class="blk">
          <h4 class="t-label">
            {m.sched_detail_series({
              index: String((d.series.index ?? 0) + 1),
              total: String(d.series.total),
            })}
          </h4>
          <div class="row wrap">
            {#each d.series.occurrences as o (o.id)}
              <Button
                size="sm"
                variant={o.id === d.booking.id ? 'primary' : 'ghost'}
                class="occ"
                disabled={o.id === d.booking.id || !onnavigate}
                onclick={() => onnavigate?.(o.id)}
              >
                {(o.seriesIndex ?? 0) + 1}. {fmtDateTime(o.startTime)} · {statusLabel(o.status)}
              </Button>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Notes: ONE field. Nothing shows a booking note to the client today, so
           a second "visible to the client" box was a promise the product does not
           keep; a note written there before the fold stays readable. -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_notes()}</h4>
        <textarea class="txt" rows="3" bind:value={internalNote} disabled={!canEdit}></textarea>
        {#if clientNote}
          <p class="t-caption legacy-note">
            <span class="t-label">{m.sched_detail_notes_client_legacy()}</span>
            {clientNote}
          </p>
        {/if}
        <div class="row">
          <Button
            size="sm"
            disabled={busy || !canEdit}
            title={canEdit ? undefined : m.no_permission()}
            onclick={saveNotes}>{m.sched_save()}</Button
          >
          {#if notesSaved}<span class="t-caption ok">{m.sched_rem_saved()}</span>{/if}
        </div>
      </section>

      <!-- Status history, oldest first; the first row (fromStatus null) is creation -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_history()}</h4>
        {#if d.statusHistory.length === 0}
          <p class="t-caption">{m.sched_detail_history_empty()}</p>
        {:else}
          <!-- A timeline: each step is the status chip it landed on (the same
               semantic ramp as the header badge), the chip it came from
               before an arrow, and one caption line for when and by whom.
               Newest last, so the rail reads top-down like the notes. -->
          <ol class="hist">
            {#each d.statusHistory as h (h.id)}
              <li class="hist-step">
                <span
                  class="hist-dot tone-{STATUS_TONE[h.toStatus] ?? 'neutral'}"
                  aria-hidden="true"
                ></span>
                <div class="hist-body">
                  <div class="hist-chips">
                    {#if h.fromStatus === null}
                      <span class="t-caption">{m.sched_detail_history_created()}</span>
                    {:else}
                      <Badge size="sm" {...statusBadge(h.fromStatus)}>
                        {statusLabel(h.fromStatus)}
                      </Badge>
                      <ArrowRight size={iconSizes.xs} class="hist-arrow" aria-hidden="true" />
                    {/if}
                    <Badge size="sm" {...statusBadge(h.toStatus)}>
                      {statusLabel(h.toStatus)}
                    </Badge>
                  </div>
                  <p class="t-caption hist-meta">
                    {fmtDateTime(
                      h.changedAt,
                    )}{#if h.changedByName}{' · '}{m.sched_detail_history_by({
                        name: h.changedByName,
                      })}{/if}
                  </p>
                  {#if h.reason}<p class="t-caption hist-reason">{h.reason}</p>{/if}
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      {#if err}<p class="t-caption bad">{err}</p>{/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if detail && isLive}
      <!-- The wrapper only exists to be the query container: an element cannot
           query its own inline size, and the Sheet owns the footer root. -->
      <div class="acts-wrap">
        <div class="acts">
          {#if cancelOpen}
            <div class="cancel-box">
              <label class="fld">
                <span class="t-caption">{m.sched_detail_cancel_reason()}</span>
                <textarea class="txt" rows="2" bind:value={cancelReason}></textarea>
              </label>
              {#if detail.series}
                <SegmentedControl
                  aria-label={m.sched_detail_cancel_scope()}
                  bind:value={cancelScope}
                  items={[
                    { value: 'one', label: m.sched_detail_cancel_scope_one() },
                    { value: 'following', label: m.sched_detail_cancel_scope_following() },
                  ]}
                />
              {/if}
              <div class="row">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onclick={() =>
                    patchStatus('cancelled', {
                      scope: detail?.series ? cancelScope : 'one',
                      reason: cancelReason || null,
                    })}>{m.sched_detail_cancel_confirm()}</Button
                >
                <Button size="sm" variant="ghost" onclick={() => (cancelOpen = false)}
                  >{m.sched_cancel()}</Button
                >
              </div>
            </div>
          {:else}
            <!-- One footer shape: the forward verbs on the left as real buttons,
               the exits (reject / no-show / cancel) on the right as quiet text
               actions. Every button is the same height; nothing wraps into a
               second uneven row on the drawer's width. -->
            <div class="acts-main">
              {#if detail.booking.status === 'pending'}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !canEdit}
                  title={canEdit ? undefined : m.no_permission()}
                  onclick={() => patchStatus('accepted')}
                >
                  <Check size={iconSizes.sm} />{m.sched_accept_booking()}
                </Button>
              {/if}
              <Button
                size="sm"
                variant={detail.booking.status === 'pending' ? 'outline' : 'primary'}
                disabled={busy || !canEdit}
                title={canEdit ? undefined : m.no_permission()}
                onclick={() => (completeOpen = true)}
              >
                <Check size={iconSizes.sm} />{m.sched_mark_complete()}
              </Button>
            </div>
            <div class="acts-exit">
              {#if detail.booking.status === 'pending'}
                <Button
                  size="sm"
                  variant="ghost"
                  class="exit-btn danger"
                  disabled={busy || !canEdit}
                  title={canEdit ? undefined : m.no_permission()}
                  onclick={() => patchStatus('rejected')}
                >
                  <Ban size={iconSizes.sm} />{m.sched_reject_booking()}
                </Button>
              {/if}
              <Button
                size="sm"
                variant="ghost"
                class="exit-btn"
                disabled={busy || !canEdit}
                title={canEdit ? undefined : m.no_permission()}
                onclick={() => patchStatus('no_show')}
              >
                <UserX size={iconSizes.sm} />{m.sched_mark_noShow()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="exit-btn"
                disabled={busy || !canEdit}
                title={canEdit ? undefined : m.no_permission()}
                onclick={() => {
                  cancelOpen = true;
                  cancelScope = 'one';
                }}
              >
                <X size={iconSizes.sm} />{m.sched_cancel_booking()}
              </Button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</Sheet>

<!-- Sibling of the Sheet, never a child: a second native dialog stacks above
     it in the top layer, while nesting it inside the drawer's <dialog> would
     trap it in the drawer's scroll box. -->
<ConsumptionConfirmDialog
  bookingId={completeOpen ? bookingId : null}
  productId={detail?.booking.productId ?? null}
  {apiBase}
  onclose={() => (completeOpen = false)}
  oncompleted={async (result) => {
    if (result.stockWarning) err = result.stockWarning.message;
    await reloadDetail();
  }}
/>

<style>
  .center {
    display: flex;
    justify-content: center;
    padding: var(--space-8);
  }
  .drawer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .blk {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  .facts dt {
    color: var(--color-text-tertiary);
  }
  .facts dd {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .crm-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-accent);
    text-decoration: none;
  }
  .txt {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    padding: var(--space-2);
    font-family: inherit;
  }
  .hist {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hist-step {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-3) 1fr;
    column-gap: var(--space-2);
    padding-bottom: var(--space-3);
  }
  /* The rail: drawn by every step but the last, from its dot down to the next. */
  .hist-step:not(:last-child)::before {
    content: '';
    position: absolute;
    left: calc(var(--space-3) / 2 - 0.5px);
    top: var(--space-3);
    bottom: 0;
    border-left: 1px solid var(--color-border);
  }
  .hist-step:last-child {
    padding-bottom: 0;
  }
  .hist-dot {
    width: var(--space-2);
    height: var(--space-2);
    margin: var(--space-1) auto 0;
    border-radius: var(--radius-full);
    background: var(--color-text-tertiary);
  }
  .hist-dot.tone-info {
    background: var(--color-info-fg);
  }
  .hist-dot.tone-success {
    background: var(--color-success-fg);
  }
  .hist-dot.tone-warning {
    background: var(--color-warning-fg);
  }
  .hist-dot.tone-error {
    background: var(--color-danger-fg);
  }
  .hist-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .hist-chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .hist-chips :global(.hist-arrow) {
    color: var(--color-text-tertiary);
  }
  .hist-meta,
  .hist-reason {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .ok {
    color: var(--color-success-fg);
  }
  .bad {
    color: var(--color-danger-fg);
  }
  /* Named container — Svelte prunes anonymous @container blocks. */
  .acts-wrap {
    container: bookingacts / inline-size;
    width: 100%;
  }
  /* Two deliberate states instead of a stray wrap: one row (forward verbs |
     exits) while it fits, two aligned full-width rows when the drawer is
     narrow. Grid owns the tracks so nothing depends on flex wrap order. */
  .acts {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }
  .acts-main,
  .acts-exit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .acts-exit {
    justify-content: flex-end;
  }
  @container bookingacts (max-width: 30rem) {
    .acts {
      grid-template-columns: 1fr;
    }
    .acts-main {
      justify-content: center;
    }
    .acts-main :global(button) {
      width: 100%;
    }
  }
  .acts-exit :global(.exit-btn) {
    color: var(--color-text-secondary);
  }
  .acts-exit :global(.exit-btn.danger) {
    color: var(--color-danger-fg);
  }
  .legacy-note {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    color: var(--color-text-secondary);
    white-space: pre-wrap;
  }
  .cancel-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    grid-column: 1 / -1; /* the reason box owns the whole footer row */
  }
  .edit-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
