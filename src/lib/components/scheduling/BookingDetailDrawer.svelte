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
    ChevronDown,
    ChevronUp,
    Pencil,
    Plus,
    ShoppingCart,
    Trash2,
    Ungroup,
    UserX,
    X,
  } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    Picker,
    SegmentedControl,
    Select,
    Spinner,
    Tooltip,
    iconSizes,
  } from '$lib/components/ui';
  import { ConfirmDialog, Sheet } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney, formatTime } from '$lib/utils/format';
  import { instantParts } from '$lib/time/zoned';
  import { resolveCalendarInstant } from './calendar-time';
  import { canAct } from '$lib/access/can.svelte';
  import ConsumptionConfirmDialog from './ConsumptionConfirmDialog.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import PlanScheduleWarning from '$lib/components/pos/PlanScheduleWarning.svelte';
  import { isInactiveMemberStatus } from './booking-groups';
  import {
    canRemoveService,
    nextOrder,
    visitRows,
    visitSummary,
    type BookingVisit,
    type VisitRow,
  } from './visit';
  import { serviceColumns } from './service-picker-columns';
  import { track } from '$lib/analytics/track';

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
    resource: { id: string; name: string; profileId: string | null } | null;
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
      scheduleIssue: 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
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
      subtotal: string;
      discount: string;
      total: string;
      note: string | null;
      payments: Array<{ method: string; amount: string }>;
      otherLines: string[];
      lineCount: number;
      emission: {
        docType: string;
        serie: string;
        correlativo: number;
        status: string;
      } | null;
      createdByName: string | null;
      invoiceId: string | null;
    }>;
    tags: { own: CalTag[]; contact: CalTag[]; service: CalTag[] };
    /** The event's services when it has more than one (`$lib/components/scheduling/visit`). */
    visit: BookingVisit | null;
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
    /** IANA organization timezone used for every label and reschedule write. */
    timeZone: string;
    /** Active organization + action boundary captured when editing begins. */
    mutationScope: string;
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
    timeZone,
    mutationScope,
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
  let editScope = $state<{ mutationScope: string; timeZone: string } | null>(null);

  // "Mark completed" → confirm the consumed stock first (owner 2026-09-25).
  let completeOpen = $state(false);

  // Cancel confirmation, inline inside the drawer.
  let cancelOpen = $state(false);
  let cancelReason = $state('');
  let cancelScope = $state<'one' | 'following'>('one');
  let eventTags = $state<CalTag[] | null>(null);
  let detailScope = '';

  let gen = 0;
  $effect(() => {
    const id = bookingId;
    const nextScope = `${mutationScope}\u0000${timeZone}`;
    const scopeChanged = detailScope !== nextScope;
    detailScope = nextScope;
    const token = ++gen;
    if (scopeChanged) {
      detail = null;
      eventTags = null;
      editScope = null;
    }
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
    formatDate(iso, { dateStyle: 'medium', timeStyle: 'short', hour12: false, timeZone });
  const fmtTime = (iso: string) => formatTime(iso, timeZone);

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
    const s = instantParts(new Date(detail.booking.startTime), timeZone);
    editDay = `${s.year}-${pad2(s.month)}-${pad2(s.day)}`;
    editTime = `${pad2(s.hour)}:${pad2(s.minute)}`;
    editResource = detail.booking.resourceId;
    editScope = { mutationScope, timeZone };
    editOpen = true;
  }
  async function applyEdit() {
    if (!bookingId || !detail) return;
    if (
      !editScope ||
      editScope.mutationScope !== mutationScope ||
      editScope.timeZone !== timeZone
    ) {
      err = m.cal_gesture_scope_changed();
      editOpen = false;
      return;
    }
    const [hour, minute] = editTime.split(':').map(Number);
    const start = resolveCalendarInstant(
      editDay,
      hour * 60 + minute,
      editScope.timeZone,
      detail.booking.startTime,
    );
    if (!start.ok) {
      err = start.kind === 'nonexistent' ? m.cal_time_nonexistent() : m.cal_time_invalid();
      return;
    }
    const duration =
      new Date(detail.booking.endTime).getTime() - new Date(detail.booking.startTime).getTime();
    busy = true;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${bookingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          start: start.instant.toISOString(),
          end: new Date(start.instant.getTime() + duration).toISOString(),
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

  // ── Services (owner ask 2026-10-07: "a single event can contain one or more
  //    services… users add/remove services straight from the tray") ──────────
  // Rows: the visit's members in order, or the booking standing in as its own
  // only service when it has no visit yet (a single-service event).
  const svcRows = $derived(
    detail
      ? visitRows({
          visit: detail.visit,
          booking: detail.booking,
          eventTypeTitle: detail.eventType?.title ?? detail.booking.title ?? '—',
          minutes: Math.round(
            (new Date(detail.booking.endTime).getTime() -
              new Date(detail.booking.startTime).getTime()) /
              60_000,
          ),
          paid: detail.tickets.length > 0,
        })
      : [],
  );
  const svcSummary = $derived(visitSummary(svcRows));
  /** Row currently mid-request — the acted-on row disables while its own
   *  request is in flight (visible feedback builds trust, see memory). The
   *  sentinel `'add'` covers the Add-service POST, which has no row yet. */
  let svcBusyId = $state<string | null>(null);

  async function reorderService(idx: number, dir: -1 | 1) {
    if (!detail) return;
    const ids = svcRows.map((r) => r.id);
    const next = nextOrder(ids, idx, dir);
    if (next === ids) return; // already at that edge
    svcBusyId = svcRows[idx].id;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${detail.booking.id}/group`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reorder: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await reloadDetail();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      svcBusyId = null;
    }
  }

  async function separateService(row: VisitRow) {
    svcBusyId = row.id;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${row.id}/group`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ detach: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      track('visit_service_separated', { members: detail?.visit?.members.length ?? 1 });
      await reloadDetail();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      svcBusyId = null;
    }
  }

  // Remove: a ConfirmDialog (same foundation as the drawer's own cancel/delete
  // flows elsewhere in the module) — the server's 409 `referenced` becomes the
  // dialog's own failure message, never a silent no-op.
  let removeOpen = $state(false);
  let removeRow = $state<VisitRow | null>(null);
  function openRemove(row: VisitRow) {
    removeRow = row;
    removeOpen = true;
  }
  async function confirmRemoveService() {
    if (!removeRow) return;
    const res = await fetch(`${apiBase}/${removeRow.id}/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ removeService: true }),
    });
    if (res.status === 409) {
      const j = (await res.json().catch(() => ({}))) as { references?: string[] };
      // Monitoring (owner ask 2026-10-07): a removal the payment gate blocked.
      track('visit_service_remove_blocked', { references: (j.references ?? []).join(',') });
      throw new Error('referenced');
    }
    if (!res.ok) throw new Error(String(res.status));
    track('visit_service_removed', { members: detail?.visit?.members.length ?? 1 });
    await reloadDetail();
  }

  // Add: the same service Picker the create form uses, filtered to active
  // event types not already in this visit. Loaded once per drawer open.
  type AddOption = { id: string; title: string; length?: number; active?: boolean };
  let addOpen = $state(false);
  let addOptions = $state<AddOption[] | null>(null);
  let addLoading = $state(false);
  const addColumns = serviceColumns<AddOption>();
  const addRows = $derived(
    (addOptions ?? []).filter(
      (et) => et.active !== false && !svcRows.some((r) => r.eventTypeId === et.id),
    ),
  );
  async function openAdd() {
    addOpen = true;
    if (addOptions !== null) return;
    addLoading = true;
    try {
      const res = await fetch('/api/scheduling/event-types');
      const j = res.ok ? await res.json() : { eventTypes: [] };
      addOptions = (j.eventTypes ?? []) as AddOption[];
    } catch {
      addOptions = [];
    } finally {
      addLoading = false;
    }
  }
  async function addService(eventTypeId: string) {
    if (!detail) return;
    svcBusyId = 'add';
    err = null;
    try {
      const res = await fetch(`${apiBase}/${detail.booking.id}/group`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addEventTypeId: eventTypeId }),
      });
      if (res.ok)
        track('visit_service_added', { members: (detail.visit?.members.length ?? 1) + 1 });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        conflictEventTypeId = eventTypeId;
        conflictMessage =
          (j.message as string | undefined) ?? m.sched_detail_service_overlap_message();
        conflictOpen = true;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      await reloadDetail();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      svcBusyId = null;
    }
  }
  let conflictOpen = $state(false);
  let conflictEventTypeId = $state<string | null>(null);
  let conflictMessage = $state('');
  async function confirmAddOverride() {
    if (!detail || !conflictEventTypeId) return;
    const res = await fetch(`${apiBase}/${detail.booking.id}/group`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addEventTypeId: conflictEventTypeId, overrideConflicts: true }),
    });
    if (!res.ok) throw new Error(String(res.status));
    track('visit_service_added', {
      members: (detail.visit?.members.length ?? 1) + 1,
      override: true,
    });
    await reloadDetail();
  }
</script>

<!-- Hover card for a payment chip: ONLY what the drawer doesn't already show.
     No customer name, no ticket number, no paid amount or date — those are on
     the chip itself. Money rows appear only when the ticket is more than this
     one booking (a discount, or more than one line). -->
{#snippet ticketCard(t: Detail['tickets'][number])}
  {@const showMoney = Number(t.discount || 0) !== 0 || t.lineCount > 1}
  {@const extra = t.otherLines.slice(0, 4)}
  {@const hidden = t.otherLines.length - extra.length}
  {@const empty =
    t.payments.length === 0 &&
    t.otherLines.length === 0 &&
    !showMoney &&
    !t.emission &&
    !t.createdByName &&
    !t.note &&
    !t.invoiceId}
  <div class="tk-card">
    {#if empty}
      <span class="t-caption">{m.sched_detail_ticket_no_more()}</span>
    {:else}
      {#if t.payments.length}
        <div class="tk-row">
          <span class="t-caption">{m.sched_detail_ticket_payments()}</span>
          <div class="tk-vals">
            {#each t.payments as p, i (i)}
              <span class="tk-pay"
                ><span class="tk-method">{p.method}</span> · {formatMoney(
                  p.amount,
                  t.currency,
                )}</span
              >
            {/each}
          </div>
        </div>
      {/if}
      {#if extra.length}
        <div class="tk-row">
          <span class="t-caption">{m.sched_detail_ticket_also()}</span>
          <div class="tk-vals">
            {#each extra as line, i (i)}
              <span class="tk-line">{line}</span>
            {/each}
            {#if hidden > 0}
              <span class="t-caption">{m.sched_detail_ticket_more({ count: String(hidden) })}</span>
            {/if}
          </div>
        </div>
      {/if}
      {#if showMoney}
        <div class="tk-row">
          <span class="t-caption">{m.fin_col_subtotal()}</span>
          <span class="tk-num">{formatMoney(t.subtotal, t.currency)}</span>
        </div>
        {#if Number(t.discount || 0) !== 0}
          <div class="tk-row">
            <span class="t-caption">{m.fin_col_discount()}</span>
            <span class="tk-num">{formatMoney(t.discount, t.currency)}</span>
          </div>
        {/if}
        <div class="tk-row">
          <span class="t-caption">{m.fin_col_total()}</span>
          <span class="tk-num tk-strong">{formatMoney(t.total, t.currency)}</span>
        </div>
      {/if}
      {#if t.emission}
        <div class="tk-row">
          <span class="t-caption">{m.sched_detail_ticket_sunat()}</span>
          <span class="tk-num"
            >{t.emission.serie}-{t.emission.correlativo}
            <span class="t-caption">· {t.emission.status}</span></span
          >
        </div>
      {/if}
      {#if t.createdByName}
        <div class="tk-row">
          <span class="t-caption">{m.sched_detail_ticket_cashier()}</span>
          <span>{t.createdByName}</span>
        </div>
      {/if}
      {#if t.note}
        <div class="tk-row">
          <span class="t-caption">{m.fin_col_note()}</span>
          <span class="tk-line">{t.note.length > 120 ? `${t.note.slice(0, 120)}…` : t.note}</span>
        </div>
      {/if}
      {#if t.invoiceId}
        <span class="t-caption tk-invoice">{m.sched_detail_ticket_open_invoice()}</span>
      {/if}
    {/if}
  </div>
{/snippet}

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
      <!-- Identity: what, who for, when, where — plus the event's own tags,
           as one more fact row (client/service tags are inherited, read-only). -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_overview()}</h4>
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
          <dd>
            {#if d.resource?.profileId}
              <a class="fact-link" href={`/team?tab=people&person=member:${d.resource.profileId}`}>
                {d.resource.name}
              </a>
            {:else}
              {d.resource?.name ?? '—'}
            {/if}
          </dd>
          <dt class="t-caption">{m.sched_booking_attendee()}</dt>
          <dd>
            {#if d.booking.crmContactId}
              <a
                class="fact-link"
                href={`/crm/${d.booking.crmContactId}`}
                title={m.sched_detail_open_contact()}
              >
                {d.contact?.displayName ?? d.booking.attendeeName ?? '—'}
              </a>
            {:else}
              {d.contact?.displayName ?? d.booking.attendeeName ?? '—'}
            {/if}
            {#if d.booking.attendeePhone}<span class="t-caption">
                · {d.booking.attendeePhone}</span
              >{/if}
            {#if d.booking.attendeeEmail}<span class="t-caption">
                · {d.booking.attendeeEmail}</span
              >{/if}
          </dd>
          <dt class="t-caption">{m.sched_detail_tags()}</dt>
          <dd class="tags-cell">
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

      <!-- Services: every procedure of this event, in visit order. A plain
           booking renders as its own single row — the section never special-
           cases it (owner ask 2026-10-07: "a single event can contain one or
           more services… keep it simple for the users"). -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_services()}</h4>
        <ul class="svc-list">
          {#each svcRows as row, idx (row.id)}
            {@const inactive = isInactiveMemberStatus(row.status)}
            {@const rowBusy = svcBusyId === row.id}
            <li class="svc-row" class:is-inactive={inactive}>
              <div class="svc-info">
                <span class="t-body svc-title">{row.title}</span>
                <span class="t-caption svc-mins">
                  {m.cal_visit_member_length({ minutes: row.minutes })}
                </span>
                <Badge size="sm" {...statusBadge(row.status)}>{statusLabel(row.status)}</Badge>
                {#if row.paid}
                  <Badge size="sm" variant="semantic" value="success">
                    {m.sched_detail_service_paid()}
                  </Badge>
                {:else}
                  <Badge size="sm">{m.sched_detail_service_unpaid()}</Badge>
                {/if}
              </div>
              {#if canEdit}
                <div class="svc-acts">
                  <Button
                    shape="icon"
                    size="xs"
                    variant="ghost"
                    aria-label={m.sched_detail_service_move_up()}
                    disabled={rowBusy || !!svcBusyId || idx === 0}
                    onclick={() => reorderService(idx, -1)}
                  >
                    <ChevronUp size={iconSizes.xs} />
                  </Button>
                  <Button
                    shape="icon"
                    size="xs"
                    variant="ghost"
                    aria-label={m.sched_detail_service_move_down()}
                    disabled={rowBusy || !!svcBusyId || idx === svcRows.length - 1}
                    onclick={() => reorderService(idx, 1)}
                  >
                    <ChevronDown size={iconSizes.xs} />
                  </Button>
                  <Button
                    shape="icon"
                    size="xs"
                    variant="ghost"
                    aria-label={m.sched_detail_service_separate()}
                    disabled={rowBusy || !!svcBusyId || svcRows.length <= 1}
                    onclick={() => separateService(row)}
                  >
                    <Ungroup size={iconSizes.xs} />
                  </Button>
                  <Button
                    shape="icon"
                    size="xs"
                    variant="ghost"
                    aria-label={m.sched_detail_service_remove()}
                    title={canRemoveService(row.referenced)
                      ? undefined
                      : m.sched_detail_service_remove_blocked()}
                    disabled={rowBusy || !!svcBusyId || !canRemoveService(row.referenced)}
                    onclick={() => openRemove(row)}
                  >
                    <Trash2 size={iconSizes.xs} />
                  </Button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if svcRows.length > 1}
          <p class="t-caption svc-summary">
            {m.sched_detail_services_summary({
              n: String(svcSummary.n),
              paid: String(svcSummary.paid),
              unpaid: String(svcSummary.unpaid),
            })}
          </p>
        {/if}
        {#if canEdit}
          <div class="row">
            <Button size="sm" variant="ghost" disabled={svcBusyId === 'add'} onclick={openAdd}>
              <Plus size={iconSizes.sm} />{m.sched_detail_service_add()}
            </Button>
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
              <Tooltip
                asChild
                interactive
                bare
                placement="top"
                openDelay={180}
                closeDelay={320}
                id="tk-{t.ticketId}"
              >
                {#snippet content()}
                  {@render ticketCard(t)}
                {/snippet}
                {#snippet children(trigger)}
                  <a {...trigger ?? {}} class="ticket-link" href={`/pos/tickets/${t.ticketId}`}>
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
                  </a>
                {/snippet}
              </Tooltip>
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
            <PlanScheduleWarning issue={d.plan.scheduleIssue} />
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

<Picker
  bind:open={addOpen}
  title={m.sched_detail_service_add()}
  columns={addColumns}
  rows={addRows}
  getRowId={(e) => e.id}
  searchText={(e) => e.title}
  onPick={(e) => addService(e.id)}
  emptyLabel={addLoading ? m.common_loading() : m.sched_empty_eventTypes()}
  searchPlaceholder={m.sched_booking_service()}
  storageKey="sched-detail-add-service"
/>

<ConfirmDialog
  bind:open={removeOpen}
  title={m.sched_detail_service_remove_title({ service: removeRow?.title ?? '' })}
  message={m.sched_detail_service_remove_message()}
  failureMessage={m.sched_detail_service_remove_blocked()}
  tone="danger"
  confirmLabel={m.sched_detail_service_remove()}
  onconfirm={confirmRemoveService}
  onclose={() => (removeRow = null)}
/>

<ConfirmDialog
  bind:open={conflictOpen}
  title={m.sched_detail_service_overlap_title()}
  message={conflictMessage || m.sched_detail_service_overlap_message()}
  confirmLabel={m.sched_detail_service_overlap_confirm()}
  failureMessage={m.sched_book_unavailable()}
  onconfirm={confirmAddOverride}
  onclose={() => {
    conflictEventTypeId = null;
    conflictMessage = '';
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
  .tags-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .svc-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .svc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }
  .svc-info {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }
  .svc-mins {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .svc-row.is-inactive .svc-title {
    text-decoration: line-through;
    color: var(--color-text-tertiary);
  }
  .svc-acts {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .svc-summary {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .fact-link,
  .ticket-link {
    color: inherit;
    text-decoration: none;
  }
  .ticket-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .fact-link:hover,
  .fact-link:focus-visible,
  .ticket-link:hover,
  .ticket-link:focus-visible {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* Payment hover card — same surface contract as the calendar's `.hover-card`:
     a 2-track label/value grid on an overlay surface. */
  .tk-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 13rem;
    max-width: 20rem;
    padding: var(--space-3);
    background: var(--color-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  .tk-row {
    display: grid;
    grid-template-columns: fit-content(6rem) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: baseline;
    font-size: var(--font-size-caption);
  }
  .tk-vals {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .tk-method {
    text-transform: capitalize;
  }
  .tk-pay,
  .tk-line {
    overflow-wrap: anywhere;
  }
  .tk-num {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .tk-strong {
    font-weight: 600;
  }
  .tk-invoice {
    color: var(--color-accent);
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
