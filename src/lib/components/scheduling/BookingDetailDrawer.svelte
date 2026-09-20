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
    Ban,
    Check,
    ExternalLink,
    Pencil,
    PlusCircle,
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
  import PlanOpenForm from '$lib/components/pos/PlanOpenForm.svelte';
  import { canChargeBooking, hasLiveBookingCharge } from '$lib/components/pos/booking-checkout';

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
      packageGrantId?: string | null;
      paymentPlanId?: string | null;
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
    contact: { id: string; displayName: string | null } | null;
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
    /** "Take payment": the host owns the POS checkout handoff. Omit to hide it. */
    onpay?: (booking: PayableBooking) => void;
    paymentTiming?: 'any_time' | 'after_completion';
  };

  let {
    bookingId,
    onclose,
    onchanged,
    onnavigate,
    resources,
    onpay,
    paymentTiming = 'any_time',
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

  // "Pay this treatment in instalments", inline inside the drawer.
  let planOpen = $state(false);

  // Reschedule (date / start time / team member), inline. Duration is kept.
  // Customer and procedure are deliberately NOT editable here (owner rule).
  let editOpen = $state(false);
  let editDay = $state('');
  let editTime = $state('');
  let editResource = $state('');

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
    planOpen = false;
    editOpen = false;
    cancelOpen = false;
    cancelReason = '';
    cancelScope = 'one';
    void (async () => {
      try {
        const res = await fetch(`/api/scheduling/bookings/${id}`);
        if (token !== gen) return; // a newer open superseded this fetch
        if (!res.ok) throw new Error(String(res.status));
        const d: Detail = await res.json();
        detail = d;
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

  const STATUS_LABEL: Record<string, () => string> = {
    accepted: () => m.sched_status_accepted(),
    pending: () => m.sched_status_pending(),
    cancelled: () => m.sched_status_cancelled(),
    rejected: () => m.sched_status_rejected(),
    completed: () => m.sched_status_completed(),
    no_show: () => m.sched_status_no_show(),
  };
  const statusLabel = (s: string) => (STATUS_LABEL[s] ?? (() => s))();

  /** One fixed semantic ramp — the same hue on every surface (governance §ramp). */
  const STATUS_TONE: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
    completed: 'success',
    cancelled: 'error',
    rejected: 'error',
    no_show: 'warning',
    pending: 'warning',
    accepted: 'info',
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
  const canEdit = $derived(canAct('scheduling', 'edit'));
  /**
   * "Pay in instalments" is a POS write, so it carries the POS capability even
   * on a scheduling surface. Offered only for a treatment that has no plan yet,
   * is still on (a cancelled booking has nothing to pay off) and has an
   * identified CRM contact — `POST /api/pos/plans` needs a client ref, and the
   * booking payload only ever carries `crmContactId`.
   */
  const canCreatePlan = $derived(canAct('pos', 'create'));
  const planOfferable = $derived(
    detail !== null &&
      detail.plan === null &&
      detail.booking.crmContactId !== null &&
      detail.booking.status !== 'cancelled' &&
      detail.booking.status !== 'rejected',
  );

  async function patchStatus(status: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return;
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (j?.stockWarning) err = j.stockWarning.message as string;
      cancelOpen = false;
      // Re-read: status history, the grant's sessionsRemaining and the accrual
      // rollup all move server-side on a status change.
      const again = await fetch(`/api/scheduling/bookings/${bookingId}`);
      if (again.ok) detail = await again.json();
      await onchanged?.();
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
      const res = await fetch(`/api/scheduling/bookings/${bookingId}`, {
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
      const again = await fetch(`/api/scheduling/bookings/${bookingId}`);
      if (again.ok) detail = await again.json();
      await onchanged?.();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }

  /** A charge makes sense for anything that will (or did) happen and is not
   *  already funded by a session package or an instalment plan. */
  const payOfferable = $derived(detail !== null && canChargeBooking(detail, paymentTiming));

  async function saveNotes() {
    if (!bookingId) return;
    busy = true;
    err = null;
    notesSaved = false;
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}/notes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: internalNote || null, clientNote: clientNote || null }),
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
          <Badge variant="semantic" value={STATUS_TONE[d.booking.status] ?? 'info'}>
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

      <!-- Payment: the POS ticket lines that charged this booking, or the charge action -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_payment()}</h4>
        {#if d.tickets.length > 0}
          <div class="row wrap">
            {#each d.tickets as t (t.ticketId)}
              <Badge
                variant="semantic"
                value={t.status === 'void' || t.status === 'voided'
                  ? 'error'
                  : t.status === 'submitted'
                    ? 'success'
                    : 'info'}
              >
                {t.status === 'void' || t.status === 'voided'
                  ? m.sched_detail_ticket_voided()
                  : t.status === 'submitted'
                    ? m.sched_detail_paid({ value: formatMoney(t.lineTotal, t.currency) })
                    : m.sched_detail_unpaid()}
              </Badge>
              <span class="t-caption">
                #{t.humanId ?? t.ticketId.slice(0, 8)}{t.submittedAt
                  ? ` · ${fmtDateTime(t.submittedAt)}`
                  : ''}
              </span>
            {/each}
          </div>
        {/if}
        {#if !hasLiveBookingCharge(d.tickets)}
          <div class="row wrap">
            <span class="t-caption">
              {#if d.grant}{m.sched_detail_covered_package()}{:else if d.plan}{m.sched_detail_covered_plan()}{:else}{m.sched_detail_unpaid()}{/if}
            </span>
            {#if onpay && payOfferable}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canAct('pos', 'edit')}
                title={canAct('pos', 'edit') ? undefined : m.no_permission()}
                onclick={() => onpay(d.booking)}
              >
                <ShoppingCart size={iconSizes.sm} />{m.sched_detail_take_payment()}
              </Button>
            {/if}
          </div>
        {/if}
      </section>

      <!-- Package grant -->
      {#if d.grant}
        <section class="blk">
          <h4 class="t-label">{m.sched_detail_package()}</h4>
          <div class="row wrap">
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
        </section>
      {/if}

      <!-- Payment plan -->
      {#if d.plan}
        <section class="blk">
          <h4 class="t-label">{m.sched_detail_plan()}</h4>
          <div class="row">
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
        </section>
      {:else if planOfferable}
        <!-- No plan yet: open one against THIS booking -->
        <section class="blk">
          <h4 class="t-label">{m.sched_detail_plan()}</h4>
          {#if planOpen}
            <PlanOpenForm
              crmContactId={d.booking.crmContactId}
              bookingId={d.booking.id}
              defaultTitle={d.eventType?.title ?? d.booking.title ?? ''}
              oncreated={async () => {
                planOpen = false;
                const again = await fetch(`/api/scheduling/bookings/${d.booking.id}`);
                if (again.ok) detail = await again.json();
                await onchanged?.();
              }}
              oncancel={() => (planOpen = false)}
            />
          {:else}
            <div class="row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !canCreatePlan}
                title={canCreatePlan ? undefined : m.no_permission()}
                onclick={() => (planOpen = true)}
              >
                <PlusCircle size={iconSizes.sm} />{m.sched_detail_plan_open()}
              </Button>
            </div>
          {/if}
        </section>
      {/if}

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

      <!-- Notes: internal + client-visible -->
      <section class="blk">
        <h4 class="t-label">{m.sched_detail_notes_internal()}</h4>
        <textarea class="txt" rows="3" bind:value={internalNote} disabled={!canEdit}></textarea>
        <h4 class="t-label">{m.sched_detail_notes_client()}</h4>
        <textarea class="txt" rows="3" bind:value={clientNote} disabled={!canEdit}></textarea>
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
          <ol class="hist">
            {#each d.statusHistory as h (h.id)}
              <li>
                <span class="t-caption">{fmtDateTime(h.changedAt)}</span>
                <span>
                  {h.fromStatus === null
                    ? m.sched_detail_created({ status: statusLabel(h.toStatus) })
                    : m.sched_detail_transition({
                        from: statusLabel(h.fromStatus),
                        to: statusLabel(h.toStatus),
                      })}
                </span>
                {#if h.changedByName}
                  <span class="t-caption"
                    >{m.sched_detail_history_by({ name: h.changedByName })}</span
                  >
                {/if}
                {#if h.reason}<span class="t-caption">— {h.reason}</span>{/if}
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
          {#if detail.booking.status === 'pending'}
            <Button
              size="sm"
              disabled={busy || !canEdit}
              title={canEdit ? undefined : m.no_permission()}
              onclick={() => patchStatus('accepted')}
            >
              <Check size={iconSizes.sm} />{m.sched_accept_booking()}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || !canEdit}
              title={canEdit ? undefined : m.no_permission()}
              onclick={() => patchStatus('rejected')}
            >
              <Ban size={iconSizes.sm} />{m.sched_reject_booking()}
            </Button>
          {/if}
          <Button
            size="sm"
            disabled={busy || !canEdit}
            title={canEdit ? undefined : m.no_permission()}
            onclick={() => patchStatus('completed')}
          >
            <Check size={iconSizes.sm} />{m.sched_mark_complete()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !canEdit}
            title={canEdit ? undefined : m.no_permission()}
            onclick={() => patchStatus('no_show')}
          >
            <UserX size={iconSizes.sm} />{m.sched_mark_noShow()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !canEdit}
            title={canEdit ? undefined : m.no_permission()}
            onclick={() => {
              cancelOpen = true;
              cancelScope = 'one';
            }}
          >
            <X size={iconSizes.sm} />{m.sched_cancel_booking()}
          </Button>
        {/if}
      </div>
    {/if}
  {/snippet}
</Sheet>

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
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hist li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .ok {
    color: var(--color-success-fg);
  }
  .bad {
    color: var(--color-danger-fg);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }
  .cancel-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
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
