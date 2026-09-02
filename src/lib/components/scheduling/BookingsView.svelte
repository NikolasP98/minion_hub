<script lang="ts">
  import { CalendarClock, Plus, Check, X, UserX, ClipboardList } from 'lucide-svelte';
  import { invalidate, goto } from '$lib/navigation';
  import {
    PageHeader,
    Card,
    Button,
    Badge,
    EmptyState,
    Modal,
    iconSizes,
  } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import { canAct } from '$lib/access/can.svelte';
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
    return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/scheduling/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await invalidate(invalidateKey);
  }

  const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

  // ── Stock consumption preview (Task 9) ──
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

  // ── Complete dialog ──
  let completeFor = $state<string | null>(null); // booking id
  let cdLines = $state<ConsumptionLine[]>([]);
  let cdBusy = $state(false);
  let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

  async function openComplete(id: string) {
    const summary = accrualBySource.get(id);
    if (!summary || summary.open === 0) {
      await completeBooking(id, null); // no accruals → one-click complete
      return;
    }
    const res = await fetch(`/api/stock/accruals?source=booking&sourceId=${id}&status=open`);
    const j = res.ok ? await res.json() : { accruals: [] };
    cdLines = (j.accruals ?? []).map((a: Record<string, unknown>) => ({
      itemId: a.itemId as string,
      itemName: a.itemName as string,
      uom: a.itemUom as string,
      qty: Number(a.qty),
      qtyConsumption: Number(a.qtyConsumption),
      consumptionUom: (a.consumptionUom as string | null) ?? null,
      unitsPerStockUom: a.unitsPerStockUom == null ? null : Number(a.unitsPerStockUom),
      subunitsPerStockUom: a.subunitsPerStockUom == null ? null : Number(a.subunitsPerStockUom),
      diagramEnabled: Boolean(a.diagramEnabled),
      available: 0,
      committedOther: 0,
      atp: 0,
    }));
    completeFor = id;
  }

  async function completeBooking(id: string, lines: ConsumptionLine[] | null) {
    cdBusy = true;
    try {
      // above-zero filter, same principle as book(): a gauge dragged to 0 must
      // not block the whole completion — drop those lines, or send null.
      const usedLines = lines?.filter((l) => l.qtyConsumption > 0) ?? null;
      const res = await fetch(`/api/scheduling/bookings/${id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: usedLines?.length
            ? usedLines.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                qtyConsumption: l.qtyConsumption,
              }))
            : null,
        }),
      });
      if (!res.ok) {
        stockWarnings = { ...stockWarnings, [id]: `complete failed (${res.status})` };
        completeFor = null;
        return;
      }
      const j = await res.json();
      if (j?.stockWarning)
        stockWarnings = { ...stockWarnings, [id]: j.stockWarning.message as string };
      else {
        const next = { ...stockWarnings };
        delete next[id];
        stockWarnings = next;
      }
      completeFor = null;
      await invalidate(invalidateKey);
    } finally {
      cdBusy = false;
    }
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

  function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
  }

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
        {#each data.bookings as b (b.id)}
          <Card padding="md">
            <div class="flex items-center gap-3 flex-wrap">
              <div class="flex-1 min-w-[180px]">
                <div class="font-medium">{eventTitle(b.eventTypeId)}</div>
                <div class="t-caption">{fmt(b.startTime)} · {resourceName(b.resourceId)}</div>
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
                    onclick={() => completeBooking(b.id, null)}>{m.sched_stock_retry_post()}</Button
                  >
                </span>
              {/if}
              <div class="flex gap-1">
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
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => setStatus(b.id, 'no_show')}
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
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => setStatus(b.id, 'cancelled')}
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
          </Card>
        {/each}
      </div>
    {/if}
  </PageBody>
</PageShell>

<Modal
  open={completeFor !== null}
  title={m.sched_complete_title()}
  onclose={() => (completeFor = null)}
>
  <div class="flex flex-col gap-3">
    <p class="t-caption">{m.sched_complete_hint()}</p>
    {#each cdLines as l (l.itemId)}
      {@const gMax = l.diagramEnabled
        ? gaugeMax({
            uom: l.uom,
            unitsPerStockUom: l.unitsPerStockUom,
            subunitsPerStockUom: l.subunitsPerStockUom,
          })
        : 0}
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-sm min-w-[120px]">{l.itemName}</span>
        {#if gMax > 0}
          <ConsumptionGauge
            max={gMax}
            unit={l.consumptionUom ?? l.uom}
            bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
          />
        {:else}
          <input
            class="txt"
            style="max-width: 90px"
            type="number"
            min="0"
            step="any"
            value={l.qtyConsumption}
            oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
          />
          <span class="t-caption">{l.consumptionUom ?? l.uom}</span>
        {/if}
      </div>
    {/each}
    <div class="flex gap-2">
      <Button disabled={cdBusy} onclick={() => completeFor && completeBooking(completeFor, cdLines)}
        >{m.sched_complete_confirm()}</Button
      >
      <Button variant="ghost" onclick={() => (completeFor = null)}>{m.sched_cancel()}</Button>
    </div>
  </div>
</Modal>

<style>
  .txt {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    background: var(--color-card);
    font-size: var(--font-size-body, 14px);
    width: 100%;
  }
</style>
