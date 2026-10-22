<script lang="ts">
  import { CalendarClock, Plus, Check, X, UserX, ClipboardList, Eye, Pencil } from 'lucide-svelte';
  import { invalidate, goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { PageHeader, Card, Button, Badge, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import BookingDetailDrawer from './BookingDetailDrawer.svelte';
  import ConsumptionConfirmDialog from './ConsumptionConfirmDialog.svelte';
  import type { CompleteResult } from './consumption-lines';
  import { canAct } from '$lib/access/can.svelte';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import { createBookingMover } from './kit/booking-mover';
  import { createBookingCustomValues } from './kit/booking-custom-values.svelte';
  import BookingCustomFields from './BookingCustomFields.svelte';
  import {
    bookingsLabels,
    type BookingCapabilities,
    type BookingsLabelNamespace,
    type BookingsViewData,
  } from './bookings-view';

  type Props = {
    /** Exactly what `loadBookingsView` returns for the hosting route. */
    data: BookingsViewData;
    capabilities: BookingCapabilities;
    /** Load-dependency key the hosting route declared, re-run after a mutation. */
    invalidateKey: string;
    labelNamespace?: BookingsLabelNamespace;
    titleId?: string;
    /** Scoping class the hosting route styles its forwarded classes through. */
    surfaceClass?: string;
  };

  let {
    data,
    capabilities,
    invalidateKey,
    labelNamespace = 'scheduling',
    titleId = 'bookings-view-title',
    surfaceClass = '',
  }: Props = $props();

  const labels = $derived(bookingsLabels(labelNamespace));

  const resourceName = (id: string) => data.resources.find((r) => r.id === id)?.name ?? '—';
  const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '—';

  const STATUS_LABEL: Record<string, () => string> = {
    accepted: () => m.sched_status_accepted(),
    pending: () => m.sched_status_pending(),
    cancelled: () => m.sched_status_cancelled(),
    rejected: () => m.sched_status_rejected(),
    completed: () => m.sched_status_completed(),
    no_show: () => m.sched_status_no_show(),
  };

  function fmt(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return formatDate(dt, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false,
      timeZone: data.orgTz,
    });
  }
  const mutationScope = $derived(`scheduling:${page.data.activeOrgId ?? 'unknown'}`);

  // Optimistic status (owner ask 2026-09-29 — "let's try to go optimist on the
  // UI feedback"), converged on the same `booking-mover.ts` kit the calendar
  // uses instead of its own bare PATCH: `moveBooking`/`reorderVisit` go unused
  // here (this view has no drag surface), only `setStatus`/`statusOf`/`pending`.
  const mover = createBookingMover({
    apiBase: '/api/scheduling/bookings',
    onError: () => {},
    refresh: () => invalidate(invalidateKey),
  });
  const rows = $derived(
    data.bookings.map((b) => ({ ...b, status: mover.statusOf(b.id, b.status) })),
  );

  const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

  /** The org's custom booking columns (HC-019): one store for the cards and
   *  the drawer, the same kit the calendar pages use. Fail-soft: a persona the
   *  definitions call refuses simply sees no custom fields. */
  const customValues = createBookingCustomValues();
  $effect(() => {
    void customValues.load();
  });
  $effect(() => {
    customValues.ensure(data.bookings.map((b) => b.id));
  });

  // ── Complete → confirm consumption (spec 033): the shared dialog owns the
  //    reads, the rows and the POST; this view only remembers which booking is open.
  let completeFor = $state<{ id: string; productId: string | null } | null>(null);
  let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

  function openComplete(id: string) {
    const et = data.eventTypes.find(
      (e) => e.id === data.bookings.find((x) => x.id === id)?.eventTypeId,
    );
    completeFor = { id, productId: et?.productId ?? null };
  }

  async function afterComplete(id: string, result: CompleteResult) {
    if (result.stockWarning)
      stockWarnings = { ...stockWarnings, [id]: result.stockWarning.message };
    else {
      const next = { ...stockWarnings };
      delete next[id];
      stockWarnings = next;
    }
    await invalidate(invalidateKey);
  }

  // Booking → Sales Order: map this booking into a commitment-to-bill and
  // jump to the Sales view. Idempotent server-side (one order per booking).
  let orderBusy = $state<string | null>(null);
  async function createOrder(id: string) {
    orderBusy = id;
    try {
      const res = await fetch(`/api/scheduling/bookings/${id}/order`, { method: 'POST' });
      if (res.ok) await goto('/sales');
    } finally {
      orderBusy = null;
    }
  }

  let attachmentsRefreshKey = $state<Record<string, number>>({});

  /** The booking whose detail drawer is open (spec §4.1) — package grant,
   *  instalment plan, series siblings and the status history live there. */
  let detailId = $state<string | null>(null);

  // New booking lives on its own route (in-page form, assistant-guidable).
  const newHref = $derived(
    data.contactId
      ? `/scheduling/bookings/new?contact=${data.contactId}`
      : '/scheduling/bookings/new',
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy={titleId} class={surfaceClass}>
  <PageHeader {titleId} title={labels.title()} subtitle={labels.subtitle() ?? undefined}>
    {#snippet leading()}
      <CalendarClock size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      <Button
        size="sm"
        href={newHref}
        disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
      >
        <Plus size={iconSizes.sm} />
        {labels.newAction()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    {#if data.contactName}<div class="mb-3">
        <ScopeBanner name={data.contactName} contactId={data.contactId} noun="bookings" />
      </div>{/if}
    {#if data.bookings.length === 0}
      <EmptyState title={m.sched_empty_bookings()} />
    {:else}
      <div class="flex flex-col gap-2">
        {#each rows as b (b.id)}
          <Card padding="md" class="bv-row">
            <div class="flex items-center gap-3 flex-wrap">
              <div class="flex-1 min-w-[180px]">
                <div class="font-medium">{eventTitle(b.eventTypeId)}</div>
                <div class="t-caption">{fmt(b.startTime)} · {resourceName(b.resourceId)}</div>
                {#if b.invoiceId && b.invoiceLabel}
                  <a class="t-caption invoice-link" href="/finances/invoices/{b.invoiceId}">
                    {m.sched_invoice_label()}: {b.invoiceLabel}
                  </a>
                {/if}
                <BookingCustomFields {customValues} bookingId={b.id} summary />
              </div>
              <div class="min-w-[120px]">
                <div class="text-sm">{b.attendeeName ?? '—'}</div>
                <div class="t-caption">{b.attendeePhone ?? ''}</div>
              </div>
              <Badge>{(STATUS_LABEL[b.status] ?? (() => b.status))()}</Badge>
              {#if accrualBySource.get(b.id)}
                {@const acc = accrualBySource.get(b.id)!}
                {#if acc.open > 0}
                  <Badge variant="semantic" value="warning"
                    >{m.sched_stock_committed({ value: formatMoney(acc.estValue) })}</Badge
                  >
                {:else if acc.realized > 0}
                  <a
                    href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'}
                    class="no-underline"
                  >
                    <Badge variant="semantic" value="success"
                      >{m.sched_stock_realized({ value: formatMoney(acc.realizedValue) })}</Badge
                    >
                  </a>
                {:else}
                  <Badge>{m.sched_stock_released()}</Badge>
                {/if}
              {/if}
              {#if stockWarnings[b.id]}
                <span class="t-caption" style="color:var(--color-destructive)">
                  {stockWarnings[b.id]}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="underline"
                    onclick={() => openComplete(b.id)}>{m.sched_stock_retry_post()}</Button
                  >
                </span>
              {/if}
              <div class="flex gap-1 bv-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  class="act"
                  title={m.sched_detail_open()}
                  onclick={() => (detailId = b.id)}
                >
                  <Eye size={iconSizes.sm} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="act"
                  title={m.sched_edit_booking()}
                  href="/scheduling/bookings/{b.id}/edit"
                >
                  <Pencil size={iconSizes.sm} />
                </Button>
                {#if b.status === 'accepted' || b.status === 'pending'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit')
                      ? m.sched_mark_complete()
                      : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => openComplete(b.id)}
                  >
                    <Check size={iconSizes.sm} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit') ? m.sched_mark_noShow() : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit') || mover.pending(b.id)}
                    loading={mover.pending(b.id)}
                    onclick={() => mover.setStatus(b.id, 'no_show')}
                  >
                    <UserX size={iconSizes.sm} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act del"
                    title={canAct('scheduling', 'edit')
                      ? m.sched_cancel_booking()
                      : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit') || mover.pending(b.id)}
                    loading={mover.pending(b.id)}
                    onclick={() => mover.setStatus(b.id, 'cancelled')}
                  >
                    <X size={iconSizes.sm} />
                  </Button>
                {/if}
                {#if capabilities.createSalesOrder && b.status !== 'cancelled' && b.status !== 'rejected'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit') ? 'Create sales order' : m.no_permission()}
                    disabled={orderBusy === b.id || !canAct('scheduling', 'edit')}
                    onclick={() => createOrder(b.id)}
                  >
                    <ClipboardList size={iconSizes.sm} />
                  </Button>
                {/if}
              </div>
            </div>
            <div class="mt-2 pt-2 border-t border-[var(--hairline)] flex flex-col gap-2">
              <AttachmentButton
                objectType="booking"
                objectId={b.id}
                size="sm"
                disabled={!canAct('scheduling', 'edit')}
                onuploaded={() =>
                  (attachmentsRefreshKey = {
                    ...attachmentsRefreshKey,
                    [b.id]: (attachmentsRefreshKey[b.id] ?? 0) + 1,
                  })}
              />
              <AttachmentList
                objectType="booking"
                objectId={b.id}
                refreshKey={attachmentsRefreshKey[b.id] ?? 0}
                compact
              />
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </PageBody>
</PageShell>

<BookingDetailDrawer
  bookingId={detailId}
  resources={data.resources}
  timeZone={data.orgTz}
  {mutationScope}
  {customValues}
  onclose={() => (detailId = null)}
  onchanged={() => invalidate(invalidateKey)}
  onnavigate={(id) => (detailId = id)}
/>

<ConsumptionConfirmDialog
  bookingId={completeFor?.id ?? null}
  productId={completeFor?.productId ?? null}
  apiBase="/api/scheduling/bookings"
  onclose={() => (completeFor = null)}
  oncompleted={(result) => afterComplete(completeFor?.id ?? '', result)}
/>

<style>
  .invoice-link {
    display: block;
    color: var(--color-accent);
    text-decoration: none;
  }
  .invoice-link:hover {
    text-decoration: underline;
  }
  /* Hover-rail affordance (DataTable's `rowActionsMode: 'hover'` recipe):
     hidden until the row is hovered/focus-within, always visible on
     touch/no-hover, and `pointer-events: none` while hidden so a hidden
     action never intercepts a click meant for the row underneath it
     (DataTable's own copy ships without that last part — fixed here). */
  .bv-actions {
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  :global(.bv-row:hover) .bv-actions,
  :global(.bv-row:focus-within) .bv-actions {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    .bv-actions {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
