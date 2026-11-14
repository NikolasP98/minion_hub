<script lang="ts">
  import { untrack as dirtyUntrack } from 'svelte';
  /**
   * Read-only POS ticket record — the page the appointment drawer's payment
   * chip and its hover card open. A POS ticket is only bridged to
   * `fin_invoices` once `invoice_provider_ref` is set, so "Open invoice" is
   * conditional: for most tickets THIS is the document.
   *
   * Layout mirrors `/sales/[id]` (record-detail shell, `.card` / `.kv` classes).
   */
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { PageHeader, Button, Badge, Modal, Select, Spinner, iconSizes } from '$lib/components/ui';
  import { invalidate } from '$app/navigation';
  import { canAct } from '$lib/access/can.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import OverviewCard, { type OverviewFact } from '$lib/records/OverviewCard.svelte';
  import { ArrowLeft } from 'lucide-svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import { presentPosTicketStatus } from '$lib/pos/ticket-status';
  import * as m from '$lib/paraglide/messages';
  import { swapOptions, type SwapCandidate } from '$lib/pos/swap-options';
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { dispatchSellChargeHandoff } from '$lib/components/pos/sell-charge-handoff';
  import VoidRefundChoice, { type RefundChoice } from '$lib/components/pos/VoidRefundChoice.svelte';
  import { voidRefusalKey } from '$lib/components/scheduling/calendar-context-menu';

  type PageData = Granted<LoadedPageData['pos']>;
  let { data }: { data: PageData } = $props();
  const t = $derived(data.ticket);
  const cur = $derived(t.currency || 'PEN');
  const back = createBackNav('/pos/sell', m.pos_ticket_back);

  type Line = PageData['lines'][number];
  type Payment = PageData['payments'][number];

  const ticketStatus = $derived(presentPosTicketStatus(t.status));
  const money = (v: string | number | null | undefined) => formatMoney(v, cur);
  const stamp = (v: Date | string | null) =>
    formatDate(v, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const nonZero = (v: string | null) => Number(v ?? 0) !== 0;

  // ── Tender correction (spec 2026-10-15-hub-pos-shift-scoped-edits S1) ──
  // Open selling shift: `pos:edit` fixes the row in place with a preset reason.
  // Closed: `pos:manage` with a typed reason; the money moves as a zero-net
  // pair on the manager's open shift and this page shows that pair.
  type PayMeta = { kind?: string; changedFrom?: string; reason?: string } | null;
  const meta = (p: Payment) => (p.metadata ?? null) as PayMeta;
  const shiftOpen = $derived(data.shiftStatus === 'open');
  const canCorrect = $derived(
    t.status !== 'void' &&
      !t.invoiceProviderRef &&
      !data.periodLocked &&
      (shiftOpen ? canAct('pos', 'edit') : canAct('pos', 'manage')),
  );
  const methodLabel = (id: string) => data.methods.find((x) => x.id === id)?.label ?? id;
  let editing = $state<Payment | null>(null);
  let newMethod = $state('');
  let reason = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);
  function openCorrection(p: Payment) {
    editing = p;
    newMethod = data.methods.find((x) => x.id !== p.method)?.id ?? '';
    reason = shiftOpen ? m.pos_tender_reason_preset() : '';
    err = null;
  }
  const ERR_BY_CODE: Record<string, () => string> = {
    no_open_shift: m.pos_tender_err_no_open_shift,
    period_locked: m.pos_tender_err_period_locked,
    emitted: m.pos_tender_err_emitted,
    manage_required: m.pos_tender_err_manage,
  };
  // "Emitir ahora" (spec 2026-10-15 T2): the shift close is the normal commit
  // point; this is for the customer who needs the comprobante on the spot.
  const liveEmission = $derived(data.emissions.some((e) => e.status !== 'error'));
  const canEmitNow = $derived(
    data.emissionMode === 'shadow' &&
      t.status !== 'void' &&
      !liveEmission &&
      !data.periodLocked &&
      canAct('pos', 'edit'),
  );
  let emitting = $state(false);
  let emitErr = $state<string | null>(null);
  async function emitNow() {
    emitting = true;
    emitErr = null;
    try {
      const res = await fetch(`/api/pos/tickets/${t.id}/emit`, { method: 'POST' });
      if (res.ok) {
        await invalidate('pos:ticket');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      emitErr =
        body.code === 'method_not_sunat'
          ? m.pos_emit_err_method()
          : (body.error ?? m.pos_emit_err_generic());
    } finally {
      emitting = false;
    }
  }
  async function saveCorrection() {
    if (!editing || !newMethod || !reason.trim()) return;
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/pos/tickets/${t.id}/payments/${editing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: newMethod, reason: reason.trim() }),
      });
      if (res.ok) {
        editing = null;
        await invalidate('pos:ticket');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      err = ERR_BY_CODE[body.code ?? '']?.() ?? body.error ?? m.pos_tender_err_generic();
    } finally {
      busy = false;
    }
  }

  // ── Product swap (meta spec 120, S4) ──
  // A product line can change to another product of the same price; money does
  // not move. Every refusal says what to do instead.
  const canSwap = $derived(t.status !== 'void' && !data.periodLocked && canAct('pos', 'edit'));
  let swapping = $state<Line | null>(null);
  let swapChoices = $state<SwapCandidate[] | null>(null);
  let swapTo = $state('');
  let swapBusy = $state(false);
  let swapErr = $state<string | null>(null);
  const SWAP_ERR: Record<string, () => string> = {
    price_differs: m.pos_swap_err_rering,
    stock_drift: m.pos_swap_err_rering,
    no_stock_entry: m.pos_swap_err_rering,
    emitted: m.pos_swap_err_rering,
    // A reconciled sale cannot be voided either: the invoice link goes first.
    reconciled: m.pos_swap_err_reconciled,
    negative_stock: m.pos_swap_err_no_stock,
    period_locked: m.pos_swap_err_period,
  };
  /** The sale is not what the dialog was opened on: reload it and start over. */
  const STALE = new Set(['line_changed', 'line_not_product', 'ticket_void', 'not_found']);
  async function openSwap(line: Line) {
    swapping = line;
    swapChoices = null;
    swapTo = '';
    swapErr = null;
    offerRering = false;
    rering = false;
    refund = 'cash';
    const res = await fetch('/api/pos/sellables');
    if (swapping?.id !== line.id) return; // closed or another line opened meanwhile
    if (!res.ok) {
      swapChoices = [];
      swapErr = m.pos_swap_err_generic();
      return;
    }
    const body = (await res.json()) as { sellables: SwapCandidate[] };
    swapChoices = swapOptions(body.sellables, line);
    swapTo = swapChoices[0]?.productId ?? '';
    offerRering = swapChoices.length === 0;
  }
  async function saveSwap() {
    if (!swapping?.finProductId || !swapTo || swapBusy) return;
    const lineId = swapping.id;
    swapBusy = true;
    swapErr = null;
    try {
      const res = await fetch(`/api/pos/tickets/${t.id}/lines/${lineId}/swap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: swapTo, expectedProductId: swapping.finProductId }),
      });
      // The reply belongs to a dialog the user already left.
      const current = () => swapping?.id === lineId;
      if (res.ok) {
        if (current()) swapping = null;
        await invalidate('pos:ticket');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (!current()) return;
      if (STALE.has(body.code ?? '')) {
        // Show the sale as it is now, with the choices for its current product.
        await invalidate('pos:ticket');
        const fresh = data.lines.find((l) => l.id === lineId);
        if (canSwap && fresh?.kind === 'product' && fresh.finProductId) await openSwap(fresh);
        else swapping = null;
        swapErr = m.pos_swap_err_changed();
        return;
      }
      swapErr = SWAP_ERR[body.code ?? '']?.() ?? m.pos_swap_err_generic();
      offerRering = RERING.has(body.code ?? '');
    } finally {
      swapBusy = false;
    }
  }
  const stockWarning = $derived(t.stockWarning as object | null);

  // ── When a swap is not enough (meta spec 120, S5) ──
  // The app does the correction with the user: it voids the sale with the
  // chosen refund and opens the till pre-filled with what the sale charged.
  const RERING = new Set(['price_differs', 'stock_drift', 'no_stock_entry', 'emitted']);
  let offerRering = $state(false);
  let rering = $state(false);
  let refund = $state<RefundChoice>('cash');
  // The till can only be pre-filled with treatments and products.
  const canRering = $derived(data.lines.every((l) => l.kind === 'service' || l.kind === 'product'));
  async function voidAndRecharge() {
    swapBusy = true;
    swapErr = null;
    try {
      const res = await fetch(`/api/pos/tickets/${t.id}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refund }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        const key = voidRefusalKey(res.status, body);
        swapErr =
          key === 'forbidden'
            ? m.pos_appt_cancel_paid_forbidden()
            : key === 'no_open_shift'
              ? m.pos_appt_cancel_paid_no_shift()
              : body.code === 'period_locked'
                ? m.pos_swap_err_period()
                : m.pos_rering_err_void();
        return;
      }
      dispatchSellChargeHandoff({
        storage: () => localStorage,
        identity: { actorId: page.data.user.id, orgId: page.data.activeOrgId ?? '' },
        input: {
          lines: data.lines.map((l) => ({
            bookingId: l.bookingId ?? null,
            productId: l.finProductId ?? null,
            title: l.description,
            kind: l.kind === 'product' ? ('product' as const) : ('service' as const),
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount ?? 0),
          })),
          partyId: t.partyId,
          customerName: t.customerName,
        },
        navigate: () => void goto('/pos/sell'),
        // The sale is already void: say so, and show it.
        onStorageFailure: () => {
          swapErr = m.pos_rering_err_storage();
          void invalidate('pos:ticket');
        },
      });
    } finally {
      swapBusy = false;
    }
  }

  const lineColumns: DataColumn<Line>[] = [
    {
      key: 'description',
      label: m.fin_col_description(),
      fill: true,
      sortable: false,
      custom: true,
    },
    {
      key: 'qty',
      label: m.fin_col_qty(),
      align: 'right',
      sortable: false,
      cellClass: 'tabular-nums',
    },
    {
      key: 'unitPrice',
      label: m.fin_col_unit_price(),
      align: 'right',
      sortable: false,
      custom: true,
      cellClass: 'tabular-nums',
    },
    {
      key: 'discount',
      label: m.fin_col_discount(),
      align: 'right',
      sortable: false,
      custom: true,
      cellClass: 'tabular-nums',
    },
    {
      key: 'total',
      label: m.fin_col_total(),
      align: 'right',
      sortable: false,
      custom: true,
      cellClass: 'tabular-nums font-semibold',
    },
  ];

  const paymentColumns: DataColumn<Payment>[] = [
    { key: 'method', label: m.fin_col_method(), sortable: false, custom: true },
    {
      key: 'amount',
      label: m.fin_col_amount(),
      align: 'right',
      sortable: false,
      custom: true,
      cellClass: 'tabular-nums font-medium',
    },
    {
      key: 'tendered',
      label: m.pos_ticket_col_tendered(),
      align: 'right',
      sortable: false,
      custom: true,
      cellClass: 'tabular-nums',
    },
    {
      key: 'paidAt',
      label: m.fin_col_paid_at(),
      sortable: false,
      custom: true,
      cellClass: 't-caption',
    },
  ];

  // The host owns custom-control edits; DOM change inference is insufficient.
  const correctionSnapshot = () => JSON.stringify([newMethod, reason]);
  let correctionBaseline = $state('');
  let correctionWasOpen = false;
  $effect(() => {
    const visible = editing !== null;
    if (visible && !correctionWasOpen)
      dirtyUntrack(() => {
        correctionBaseline = correctionSnapshot();
      });
    correctionWasOpen = visible;
  });
  const correctionDirty = $derived(editing !== null && correctionSnapshot() !== correctionBaseline);
</script>

<svelte:head
  ><title>{t.humanId ?? m.pos_ticket_title()} — {m.pos_ticket_title()}</title></svelte:head
>

{#snippet swapAction(row: Line)}
  {#if row.kind === 'product' && row.finProductId}
    <Button variant="outline" size="xs" type="button" onclick={() => openSwap(row)}
      >{m.pos_swap_action()}</Button
    >
  {/if}
{/snippet}

<PageShell archetype="record-detail" scroll="region" labelledBy="pos-ticket-title">
  <PageHeader
    titleId="pos-ticket-title"
    title={`#${t.humanId ?? t.id.slice(0, 8)}`}
    subtitle={`${m.pos_ticket_title()} · ${stamp(t.submittedAt)}`}
  >
    {#snippet leading()}
      <Button
        variant="ghost"
        size="sm"
        class="-ml-1"
        onclick={back.go}
        aria-label={m.pos_ticket_back()}
      >
        <ArrowLeft size={iconSizes.md} />
      </Button>
    {/snippet}
    {#snippet actions()}
      {#if data.periodLocked}
        <Badge variant="semantic" value="warning">{m.pos_tender_err_period_locked()}</Badge>
      {/if}
      <Badge variant="semantic" value={ticketStatus.badgeValue}>
        {ticketStatus.label === 'voided'
          ? m.pos_ticket_status_voided()
          : m.pos_ticket_status_submitted()}
      </Badge>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <div class="flex flex-col gap-4 min-h-0">
      <section class="card">
        <header class="card-h">
          <span>{m.pos_ticket_section_lines()}</span>
          {#if t.stockEntryId}
            <a class="card-link" href={`/stock/entries/${t.stockEntryId}`}
              >{m.pos_ticket_stock_link()}</a
            >
          {/if}
        </header>
        <!-- The correction sits at the end of its row, always visible: staff must
             not have to hover to find it. -->
        <DataTable
          variant="plain"
          data={data.lines}
          columns={lineColumns}
          getRowId={(l) => l.id}
          rowActions={canSwap ? swapAction : undefined}
          rowActionsMode="always"
          rowActionsWidth={156}
        >
          {#snippet cell(row: Line, col: DataColumn<Line>)}
            {#if col.key === 'description'}
              <span class="pay-method">
                {#if row.bookingId}
                  <!-- TODO(handoff): no calendar deep-link param exists yet —
                       /pos/appointments keeps the open booking in local state
                       only (`detailId`), and no route reads a `booking` search
                       param, so a service line can only point at the bookings
                       list. Wire a `?booking=<id>` param into
                       src/routes/(app)/pos/appointments/+page.svelte (and the
                       shared calendar page kit) and switch this href to it. -->
                  <a class="link" href="/scheduling/bookings">{row.description}</a>
                {:else}
                  <span>{row.description}</span>
                {/if}
                <!-- TODO(handoff): a swap is recorded in the audit log but this
                     page does not show it ("Cambiado de X a Y por …"); see meta
                     proposals/2026-11-14-hub-till-corrections-followups.md item 10. -->
              </span>
            {:else if col.key === 'unitPrice'}
              {money(row.unitPrice)}
            {:else if col.key === 'discount'}
              {nonZero(row.discount) ? money(row.discount) : ''}
            {:else if col.key === 'total'}
              {money(row.total)}
            {/if}
          {/snippet}
        </DataTable>
        {#if stockWarning}
          <p class="t-caption stock-warn" role="status">
            {m.pos_ticket_stock_warning()}
          </p>
        {/if}
      </section>

      {#if data.payments.length > 0}
        <section class="card">
          <header class="card-h"><span>{m.pos_ticket_section_payments()}</span></header>
          <DataTable
            variant="plain"
            data={data.payments}
            columns={paymentColumns}
            getRowId={(p) => p.id}
          >
            {#snippet cell(row: Payment, col: DataColumn<Payment>)}
              {#if col.key === 'method'}
                <span class="pay-method">
                  <span>{methodLabel(row.method)}</span>
                  {#if meta(row)?.kind === 'correction'}
                    <span title={meta(row)?.reason}>
                      <Badge variant="semantic" value="info" size="sm"
                        >{m.pos_tender_correction()}</Badge
                      >
                    </span>
                  {:else if meta(row)?.changedFrom}
                    <span
                      title={`${methodLabel(meta(row)?.changedFrom ?? '')} → ${methodLabel(row.method)} · ${meta(row)?.reason ?? ''}`}
                    >
                      <Badge variant="semantic" value="info" size="sm"
                        >{m.pos_tender_corrected()}</Badge
                      >
                    </span>
                  {/if}
                  {#if canCorrect && meta(row)?.kind !== 'correction' && meta(row)?.kind !== 'refund'}
                    <Button
                      variant="ghost"
                      size="xs"
                      type="button"
                      onclick={() => openCorrection(row)}>{m.pos_tender_change()}</Button
                    >
                  {/if}
                </span>
              {:else if col.key === 'amount'}
                {money(row.amount)}
              {:else if col.key === 'tendered'}
                {row.tendered ? money(row.tendered) : ''}
              {:else if col.key === 'paidAt'}
                {stamp(row.paidAt)}
              {/if}
            {/snippet}
          </DataTable>
        </section>
      {/if}

      {#if data.emissions.length > 0 || canEmitNow}
        <section class="card">
          <header class="card-h">
            <span>{m.pos_ticket_section_sunat()}</span>
            {#if canEmitNow}
              <Button
                variant="outline"
                size="xs"
                type="button"
                disabled={emitting}
                onclick={emitNow}>{m.pos_emit_now()}</Button
              >
            {/if}
          </header>
          {#if emitErr}
            <p class="t-caption tender-err" role="alert">{emitErr}</p>
          {/if}
          <ul class="plain">
            {#each data.emissions as e (e.id)}
              <li>
                <span>{e.serie}-{e.correlativo}</span>
                <span class="t-caption">{e.docType} · {e.environment}</span>
                <Badge
                  variant="semantic"
                  size="sm"
                  value={e.status === 'accepted'
                    ? 'success'
                    : e.status === 'pending'
                      ? 'warning'
                      : 'error'}
                >
                  {e.status}
                </Badge>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <div class="flex flex-col gap-4">
      <section class="card">
        <header class="card-h"><span>{m.pos_ticket_section_totals()}</span></header>
        <dl class="kv">
          <div>
            <dt>{m.fin_col_subtotal()}</dt>
            <dd>{money(t.subtotal)}</dd>
          </div>
          {#if nonZero(t.discount)}
            <div>
              <dt>{m.fin_col_discount()}</dt>
              <dd>{money(t.discount)}</dd>
            </div>
          {/if}
          <div>
            <dt>{m.fin_col_total()}</dt>
            <dd class="grand">{money(t.total)}</dd>
          </div>
        </dl>
      </section>

      {#snippet customerFact()}
        {#if t.crmContactId}
          <a class="link" href={`/crm/${t.crmContactId}`}>{t.customerName ?? '—'}</a>
        {:else}
          {t.customerName ?? '—'}
        {/if}
      {/snippet}
      {#snippet invoiceFact()}
        <a class="link" href={`/finances/invoices/${data.invoiceId}`}
          >{m.pos_ticket_open_invoice()} →</a
        >
      {/snippet}
      <OverviewCard
        tableId="pos.tickets"
        title={m.pos_ticket_section_about()}
        facts={[
          { key: 'customer', label: m.pos_ticket_customer(), render: customerFact },
          ...(data.createdByName
            ? [{ key: 'cashier', label: m.pos_ticket_cashier(), value: data.createdByName }]
            : []),
          ...(t.note ? [{ key: 'note', label: m.fin_col_note(), value: t.note }] : []),
          ...(data.invoiceId
            ? [{ key: 'invoice', label: m.fin_invoice_detail_title(), render: invoiceFact }]
            : []),
        ] as OverviewFact[]}
      />
    </div>
  </PageBody>
</PageShell>

<Modal
  dirty={correctionDirty}
  open={editing !== null}
  onclose={() => (editing = null)}
  title={m.pos_tender_title()}
  size="sm"
>
  {#if editing}
    <div class="tender-form">
      <p class="t-caption">
        {methodLabel(editing.method)} · {money(editing.amount)}
      </p>
      {#if !shiftOpen}
        <p class="t-caption">{m.pos_tender_closed_note()}</p>
      {/if}
      <label class="field">
        <span class="lbl">{m.pos_tender_new_method()}</span>
        <Select
          bind:value={newMethod}
          options={data.methods
            .filter((x) => x.id !== editing?.method)
            .map((x) => ({ value: x.id, label: x.label }))}
        />
      </label>
      <label class="field">
        <span class="lbl">{m.pos_tender_reason()}</span>
        <textarea bind:value={reason} rows="2" required></textarea>
      </label>
      {#if err}
        <p class="t-caption tender-err" role="alert">{err}</p>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button
      type="button"
      variant="primary"
      disabled={busy || !newMethod || !reason.trim()}
      onclick={saveCorrection}>{m.pos_tender_save()}</Button
    >
  {/snippet}
</Modal>

<Modal
  open={swapping !== null}
  onclose={() => (swapping = null)}
  title={m.pos_swap_title()}
  size="sm"
>
  {#if swapping}
    <div class="tender-form">
      <p class="t-caption">{swapping.description} · {money(swapping.unitPrice)}</p>
      {#if rering}
        <p class="t-caption">{m.pos_rering_explain()}</p>
        <VoidRefundChoice bind:value={refund} />
      {:else if swapChoices === null}
        <Spinner size="sm" />
      {:else if swapChoices.length}
        <Select
          label={m.pos_swap_new()}
          bind:value={swapTo}
          options={swapChoices.map((s) => ({ value: s.productId, label: s.name }))}
        />
        <p class="t-caption">{m.pos_swap_note()}</p>
      {:else if !swapErr}
        <p class="t-caption">{m.pos_swap_none()}</p>
      {/if}
      {#if swapErr}
        <p class="t-caption tender-err" role="alert">{swapErr}</p>
      {/if}
      {#if offerRering && !rering}
        {#if !canRering}
          <p class="t-caption">{m.pos_rering_manual()}</p>
        {:else if !canAct('pos', 'manage')}
          <p class="t-caption">{m.pos_appt_cancel_paid_forbidden()}</p>
        {/if}
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if rering}
      <Button type="button" variant="primary" loading={swapBusy} onclick={voidAndRecharge}
        >{m.pos_rering_action()}</Button
      >
    {:else if offerRering && canRering && canAct('pos', 'manage')}
      <Button
        type="button"
        variant="primary"
        onclick={() => {
          rering = true;
          swapErr = null;
        }}>{m.pos_rering_action()}</Button
      >
    {:else}
      <Button
        type="button"
        variant="primary"
        loading={swapBusy}
        disabled={swapBusy || !swapTo}
        onclick={saveSwap}>{m.pos_swap_save()}</Button
      >
    {/if}
  {/snippet}
</Modal>

<style>
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .kv div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: var(--font-size-body);
  }
  .kv dt {
    color: var(--color-text-secondary);
  }
  .kv dd {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .grand {
    font-weight: 600;
  }
  .plain {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plain li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
  }
  .pay-method {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tender-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lbl {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .tender-form textarea {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-canvas);
    color: var(--color-foreground);
    font-size: var(--font-size-body);
  }
  .tender-err {
    color: var(--color-danger-fg);
  }
  .stock-warn {
    margin-top: var(--space-2);
    color: var(--color-warning-fg);
  }
  .card-link {
    color: var(--color-accent);
    text-transform: inherit;
    letter-spacing: inherit;
    text-decoration: none;
  }
  .card-link:hover,
  .card-link:focus-visible {
    text-decoration: underline;
  }
  .link {
    color: inherit;
    text-decoration: none;
  }
  .link:hover,
  .link:focus-visible {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
