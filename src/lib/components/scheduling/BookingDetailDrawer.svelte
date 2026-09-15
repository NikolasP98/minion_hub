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
  import { Check, ExternalLink, UserX, X } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    SegmentedControl,
    Spinner,
    iconSizes,
  } from '$lib/components/ui';
  import { Sheet } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { canAct } from '$lib/access/can.svelte';

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
  };

  type Props = {
    /** Non-null opens the drawer and triggers the fetch. */
    bookingId: string | null;
    /** Parent clears its `bookingId`. */
    onclose: () => void;
    /** Fired after any mutation so the host can `invalidate()` its list. */
    onchanged?: () => void | Promise<void>;
    /** Jump to a sibling occurrence without closing the drawer. */
    onnavigate?: (id: string) => void;
  };

  let { bookingId, onclose, onchanged, onnavigate }: Props = $props();

  let detail = $state<Detail | null>(null);
  let loading = $state(false);
  let err = $state<string | null>(null);
  let busy = $state(false);

  // Notes are seeded once per loaded booking (an editable field must not be a
  // $derived read-through — that wipes the user's typing on every re-render).
  let internalNote = $state('');
  let clientNote = $state('');
  let notesSaved = $state(false);

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
  // TODO(handoff): spec §4.1 also lists reschedule, "charge in POS",
  // "pay in instalments" and "book the next session from the remaining grant" as
  // drawer actions. S4's scheduling half wires complete / no-show / cancel only;
  // the other four need POS surfaces this slice must not touch. Same proposal §16.
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const isLive = $derived(
    detail?.booking.status === 'accepted' || detail?.booking.status === 'pending',
  );
  const canEdit = $derived(canAct('scheduling', 'edit'));

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
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
