<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarDays, Plus, Check, X, UserX, ShoppingCart } from 'lucide-svelte';
  import { invalidate, goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { PageHeader, Button, Badge, Modal, iconSizes } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import BookingCalendar from '$lib/components/scheduling/BookingCalendar.svelte';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import type { CalendarView } from '$lib/components/scheduling/calendar-window';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';

  let { data }: { data: PageData } = $props();

  type Booking = PageData['bookings'][number];

  /** The booking whose detail drawer is open — same surface as /scheduling. */
  let detailId = $state<string | null>(null);

  /** View + focused date live in the URL, so refresh and Back both behave. */
  function navigate(next: { view?: CalendarView; date?: string }) {
    const params = new URLSearchParams({
      view: next.view ?? data.view,
      date: next.date ?? data.day,
    });
    return goto(`?${params}`, { keepFocus: true, noScroll: true });
  }

  /** Empty grid space → the new-appointment PAGE with the slot prefilled. */
  function newAt(day: string, time: string, resourceId: string | null) {
    const params = new URLSearchParams({ date: day, time, view: data.view });
    if (resourceId) params.set('resourceId', resourceId);
    return goto(`/pos/appointments/new?${params}`);
  }

  /** Drag/resize commit: the server re-runs the conflict check (409). */
  async function moveBooking(id: string, next: { start: string; end: string; resourceId: string }) {
    const res = await fetch(`/api/scheduling/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toastError(m.sched_move_failed(), j.message ?? `HTTP ${res.status}`);
    }
    await invalidate('pos:appointments');
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/scheduling/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await invalidate('pos:appointments');
  }

  const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

  // ── Complete dialog (stock accrual realization) ──
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
  let completeFor = $state<string | null>(null); // booking id
  let cdLines = $state<ConsumptionLine[]>([]);
  let cdBusy = $state(false);
  let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

  function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
  }

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
      // positive-filter: a gauge dragged to 0 must not block the whole
      // completion — drop non-positive lines, or send null.
      const positiveLines = lines?.filter((l) => l.qtyConsumption > 0) ?? null;
      const res = await fetch(`/api/scheduling/bookings/${id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: positiveLines?.length
            ? positiveLines.map((l) => ({
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
      await invalidate('pos:appointments');
    } finally {
      cdBusy = false;
    }
  }

  // ── Booking → charge handoff (Fresha-style checkout) ── writes the completed
  // booking to a consume-once key and lands on /pos/sell with the cart
  // pre-filled (service line rides pos_ticket_lines.bookingId).
  function chargeBooking(
    b: Pick<
      Booking,
      'id' | 'eventTypeId' | 'productId' | 'partyId' | 'attendeeName' | 'attendeePhone'
    >,
  ) {
    const et = data.eventTypes.find((e) => e.id === b.eventTypeId);
    localStorage.setItem(
      `pos-charge-${page.data.activeOrgId ?? 'default'}`,
      JSON.stringify({
        bookingId: b.id,
        productId: b.productId ?? et?.productId ?? null,
        partyId: b.partyId ?? null,
        customerName: b.attendeeName ?? null,
        phone: b.attendeePhone ?? null,
      }),
    );
    goto('/pos/sell');
  }
</script>

<svelte:head><title>{m.pos_nav_appointments()} · {m.nav_pos()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="pos-appointments-title"
  class="pos-appointments-surface"
>
  <PageHeader titleId="pos-appointments-title" title={m.pos_nav_appointments()}>
    {#snippet leading()}
      <CalendarDays size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet primaryActions()}
      <Button
        size="sm"
        href="/pos/appointments/new?date={data.day}&view={data.view}"
        disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
      >
        <Plus size={iconSizes.sm} />
        {m.pos_appt_new()}
      </Button>
    {/snippet}
  </PageHeader>

  <BookingCalendar
    view={data.view}
    date={data.day}
    bookings={data.bookings}
    resources={data.resources}
    eventTypes={data.eventTypes}
    onview={(view) => navigate({ view })}
    ondate={(date) => navigate({ date })}
    onopen={(id) => (detailId = id)}
    onslot={newAt}
    hours={data.hours}
    onmove={canAct('scheduling', 'edit') ? moveBooking : undefined}
  >
    <!-- POS-only extras. The grid, hover card, views and navigation are shared. -->
    {#snippet chips(b)}
      {@const acc = accrualBySource.get(b.id)}
      {#if acc}
        {#if acc.open > 0}
          <Badge variant="semantic" value="warning" size="sm"
            >{m.sched_stock_committed({ value: formatMoney(acc.estValue) })}</Badge
          >
        {:else if acc.realized > 0}
          <a
            href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'}
            class="no-underline"
          >
            <Badge variant="semantic" value="success" size="sm"
              >{m.sched_stock_realized({ value: formatMoney(acc.realizedValue) })}</Badge
            >
          </a>
        {:else}
          <Badge size="sm">{m.sched_stock_released()}</Badge>
        {/if}
      {/if}
      {#if stockWarnings[b.id]}
        <span class="t-caption warn">
          {stockWarnings[b.id]}
          <Button variant="ghost" size="sm" onclick={() => completeBooking(b.id, null)}
            >{m.sched_stock_retry_post()}</Button
          >
        </span>
      {/if}
    {/snippet}

    <!-- PATCH/complete live under /api/scheduling → gated centrally by
         scheduling:edit, not pos:edit — gate on that capability here too. -->
    {#snippet actions(b)}
      {#if b.status === 'completed' && canAct('pos', 'edit')}
        <Button variant="outline" size="sm" onclick={() => chargeBooking(b as Booking)}>
          <ShoppingCart size={iconSizes.sm} />
          {m.pos_appt_charge()}
        </Button>
      {/if}
      {#if b.status === 'accepted' || b.status === 'pending'}
        <Button
          variant="ghost"
          size="sm"
          title={canAct('scheduling', 'edit') ? m.sched_mark_complete() : m.no_permission()}
          aria-label={m.sched_mark_complete()}
          disabled={!canAct('scheduling', 'edit')}
          onclick={() => openComplete(b.id)}
        >
          <Check size={iconSizes.sm} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={canAct('scheduling', 'edit') ? m.sched_mark_noShow() : m.no_permission()}
          aria-label={m.sched_mark_noShow()}
          disabled={!canAct('scheduling', 'edit')}
          onclick={() => setStatus(b.id, 'no_show')}
        >
          <UserX size={iconSizes.sm} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={canAct('scheduling', 'edit') ? m.sched_cancel_booking() : m.no_permission()}
          aria-label={m.sched_cancel_booking()}
          disabled={!canAct('scheduling', 'edit')}
          onclick={() => setStatus(b.id, 'cancelled')}
        >
          <X size={iconSizes.sm} />
        </Button>
      {/if}
    {/snippet}
  </BookingCalendar>
</PageShell>

<BookingDetailDrawer
  bookingId={detailId}
  onclose={() => (detailId = null)}
  onchanged={() => invalidate('pos:appointments')}
  onnavigate={(id) => (detailId = id)}
  resources={data.resources}
  onpay={canAct('pos', 'edit') ? chargeBooking : undefined}
/>

<Modal
  open={completeFor !== null}
  title={m.sched_complete_title()}
  onclose={() => (completeFor = null)}
>
  <div class="complete-body">
    <p class="t-caption">{m.sched_complete_hint()}</p>
    {#each cdLines as l (l.itemId)}
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
            class="qty"
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
    <div class="line">
      <Button disabled={cdBusy} onclick={() => completeFor && completeBooking(completeFor, cdLines)}
        >{m.sched_complete_confirm()}</Button
      >
      <Button variant="ghost" onclick={() => (completeFor = null)}>{m.sched_cancel()}</Button>
    </div>
  </div>
</Modal>

<style>
  .complete-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
  .qty {
    width: 6rem;
    height: var(--control-height-md);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
  }
  .warn {
    color: var(--color-danger-fg);
  }
</style>
