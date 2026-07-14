<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    ArrowLeft,
    FileText,
    Check,
    AlertTriangle,
    Ban,
    ExternalLink,
    Boxes,
    Trash2,
  } from 'lucide-svelte';
  import { PageHeader, Button, Modal, Select, Badge, Combobox } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import {
    entryStatusVariant,
    gaugeMax,
    type UomConvertible,
  } from '$lib/components/stock/stock-ui';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';

  let { data }: { data: PageData } = $props();
  const back = createBackNav('/finances/invoices', m.fin_back_to_invoices);
  const inv = $derived(data.invoice);
  const items = $derived(data.items);
  const payments = $derived(data.payments);
  const crmContactId = $derived(data.crmContactId);
  const stockEntry = $derived(data.stockEntry);
  const stockStatusV = $derived(stockEntry ? entryStatusVariant(stockEntry.status) : null);

  const isVoid = $derived(inv.status === 'void');

  function fmtDate(d: Date | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  // Money: PEN renders with an "S/" prefix; any other currency falls back to its code.
  const sym = $derived(inv.currency && inv.currency !== 'PEN' ? `${inv.currency} ` : 'S/ ');
  function money(v: string | number | null) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Skip empty/zero optional fields (don't reserve layout for noise).
  const hasVal = (v: unknown) => v != null && v !== '' && v !== '—';
  const numVal = (v: string | null) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // ── Paid vs owed (the emotional core) ───────────────────────────────────────
  // Money received = sum of non-void payments. Outstanding = total − received.
  // Imported invoices often carry a null/0 stored total though line items exist —
  // reconstruct Σitems + tax − discount (matches recorded payments for all such rows).
  const itemsSubtotal = $derived(items.reduce((s, it) => s + numVal(it.total), 0));
  const total = $derived(
    numVal(inv.total) !== 0
      ? numVal(inv.total)
      : itemsSubtotal + numVal(inv.tax) - numVal(inv.discount),
  );
  const paid = $derived(
    payments.reduce((s, p) => s + (p.status === 'void' ? 0 : numVal(p.amount)), 0),
  );
  const outstanding = $derived(total - paid);
  type PayState = 'full' | 'partial' | 'unpaid';
  const payState = $derived<PayState>(
    outstanding <= 0.005 ? 'full' : paid > 0.005 ? 'partial' : 'unpaid',
  );
  // Flag when the stored status disagrees with the money math (stale flag guard).
  const statusMismatch = $derived(
    !isVoid &&
      ((payState === 'full' && inv.status != null && inv.status !== 'paid') ||
        (payState !== 'full' && inv.status === 'paid')),
  );

  const subtotalMeaningful = $derived(hasVal(inv.subtotal) && numVal(inv.subtotal) !== total);
  const discountNonZero = $derived(numVal(inv.discount) > 0);
  const taxNonZero = $derived(numVal(inv.tax) > 0);
  // Distinct payment methods (secondary info, surfaced in the meta-row).
  const methods = $derived([...new Set(payments.map((p) => p.method).filter(hasVal))] as string[]);
  const hasMeta = $derived(
    methods.length > 0 ||
      hasVal(inv.clientDocNumber) ||
      subtotalMeaningful ||
      taxNonZero ||
      discountNonZero ||
      hasVal(inv.note),
  );

  // ── Stock issue dialog ───────────────────────────────────────────────────
  // available: null for manually added lines (no bin lookup client-side).
  // qtyConsumption/consumptionUom/unitsPerStockUom/subunitsPerStockUom/diagramEnabled:
  // P5.1b contract fields — server fills them once the parallel UOM-conversion migration
  // lands; until then we backfill from data.stockItems so the gauge still renders.
  type PreviewLine = {
    itemId: string;
    itemName: string;
    itemCode: string;
    uom: string;
    qty: string;
    available: number | null;
    qtyConsumption?: number;
    consumptionUom?: string | null;
    unitsPerStockUom?: number | string | null;
    subunitsPerStockUom?: number | string | null;
    diagramEnabled?: boolean;
  };
  type ItemUom = (typeof data.stockItems)[number] &
    Partial<UomConvertible> & { diagramEnabled?: boolean };
  const stockItemById = $derived(new Map((data.stockItems as ItemUom[]).map((i) => [i.id, i])));

  type PartialPreviewInput = { itemId: string; qty: string | number } & Partial<
    Omit<PreviewLine, 'itemId' | 'qty'>
  >;

  /** Fill server-contract UOM fields from the item catalog when the API hasn't sent them yet. */
  function withUomFields(l: PartialPreviewInput): PreviewLine {
    const item = stockItemById.get(l.itemId);
    const unitsPerStockUom = l.unitsPerStockUom ?? item?.unitsPerStockUom ?? null;
    const qtyConsumption =
      l.qtyConsumption ?? (unitsPerStockUom ? Number(l.qty) * Number(unitsPerStockUom) : undefined);
    return {
      itemId: l.itemId,
      itemName: l.itemName ?? item?.name ?? l.itemId,
      itemCode: l.itemCode ?? item?.code ?? '',
      uom: l.uom ?? item?.uom ?? 'unit',
      qty: String(l.qty),
      available: l.available ?? null,
      qtyConsumption,
      consumptionUom: l.consumptionUom ?? item?.consumptionUom ?? null,
      unitsPerStockUom,
      subunitsPerStockUom: l.subunitsPerStockUom ?? item?.subunitsPerStockUom ?? null,
      diagramEnabled: l.diagramEnabled ?? item?.diagramEnabled ?? false,
    };
  }

  /** Gauge unit ceiling for a preview line (0 when the item has no diagram configured). */
  function lineGaugeMax(l: PreviewLine): number {
    return l.diagramEnabled
      ? gaugeMax({
          uom: l.uom,
          unitsPerStockUom: l.unitsPerStockUom,
          subunitsPerStockUom: l.subunitsPerStockUom,
        })
      : 0;
  }

  /** Sync qty(stock uom) ↔ qtyConsumption whichever direction the user edited from. */
  function setLineQty(l: PreviewLine, qty: string) {
    l.qty = qty;
    if (l.unitsPerStockUom) l.qtyConsumption = Number(qty) * Number(l.unitsPerStockUom);
  }
  function setLineConsumption(l: PreviewLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    if (l.unitsPerStockUom) l.qty = String(qtyConsumption / Number(l.unitsPerStockUom));
  }

  let issueDialogOpen = $state(false);
  let issueWarehouseId = $state('');
  let previewLines = $state<PreviewLine[]>([]);
  let unmatched = $state<Array<{ description: string; quantity: number }>>([]);
  let previewBusy = $state(false);
  let issueBusy = $state(false);
  let issueErr = $state<string | null>(null);

  // Manual add-line (items the consumption map didn't cover).
  let addItemId = $state('');
  let addQty = $state('');
  const canAddLine = $derived(addItemId !== '' && Number(addQty) > 0);

  function addPreviewLine() {
    if (!canAddLine) return;
    const existing = previewLines.find((l) => l.itemId === addItemId);
    if (existing) {
      // Duplicate item → merge quantities instead of a second row.
      setLineQty(existing, String(Number(existing.qty) + Number(addQty)));
    } else {
      previewLines = [
        ...previewLines,
        withUomFields({ itemId: addItemId, qty: addQty, available: null }),
      ];
    }
    addItemId = '';
    addQty = '';
  }

  function openIssueDialog() {
    issueWarehouseId = '';
    previewLines = [];
    unmatched = [];
    addItemId = '';
    addQty = '';
    issueErr = null;
    issueDialogOpen = true;
  }

  async function issueErrMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      if (res.status === 409) return body?.message ?? m.fin_stock_issue_duplicate();
      return body?.message ?? m.fin_stock_issue_failed();
    } catch {
      return m.fin_stock_issue_failed();
    }
  }

  async function loadPreview() {
    if (!issueWarehouseId) return;
    previewBusy = true;
    issueErr = null;
    try {
      const res = await fetch('/api/stock/entries/from-invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id, warehouseId: issueWarehouseId, preview: true }),
      });
      if (res.ok) {
        const body = await res.json();
        const preview = body.preview ?? { lines: [], unmatched: [] };
        previewLines = (preview.lines ?? []).map((l: Omit<PreviewLine, 'qty'> & { qty: number }) =>
          withUomFields(l),
        );
        unmatched = preview.unmatched ?? [];
      } else {
        issueErr = await issueErrMessage(res);
      }
    } finally {
      previewBusy = false;
    }
  }

  function removePreviewLine(i: number) {
    previewLines = previewLines.filter((_, idx) => idx !== i);
  }

  async function saveIssue(submit: boolean) {
    issueBusy = true;
    issueErr = null;
    try {
      const res = await fetch('/api/stock/entries/from-invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceId: inv.id,
          warehouseId: issueWarehouseId,
          lines: previewLines.map((l) => ({
            itemId: l.itemId,
            qty: Number(l.qty),
            ...(l.qtyConsumption != null ? { qtyConsumption: l.qtyConsumption } : {}),
          })),
          submit,
        }),
      });
      if (res.ok) {
        issueDialogOpen = false;
        await invalidate('finances:data');
      } else {
        issueErr = await issueErrMessage(res);
      }
    } finally {
      issueBusy = false;
    }
  }
</script>

<svelte:head
  ><title>{m.fin_invoice_detail_title()} {inv.number ?? inv.documentId ?? ''}</title></svelte:head
>

<PageShell archetype="record-detail" scroll="region" labelledBy="finances-invoices-id-title">
  <PageHeader
    titleId="finances-invoices-id-title"
    title={`${m.fin_invoice_detail_title()} ${inv.number ?? inv.documentId ?? inv.id}`}
    subtitle={m.fin_invoice_detail_subtitle()}
  >
    {#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-4 max-w-4xl">
    <Button variant="outline" size="sm" onclick={back.go} class="self-start">
      <ArrowLeft size={14} />
      {back.label}
    </Button>

    {#if isVoid}
      <div class="void-banner">
        <Ban size={16} />
        <span>{m.fin_inv_void_banner()}</span>
      </div>
    {/if}

    <div class="content" class:voided={isVoid}>
      <!-- One continuous invoice "document": hero head + item/payment sections
			     joined by hairline dividers (no inner borders/radii/seams). -->
      <div class="doc">
        <!-- Hero band: identity + total on the left, payment reconciliation on the
			     right. Secondary fields fold into a separated strip at the bottom. -->
        <section class="hero">
          <div class="hero-top">
            <div class="hero-main">
              <span class="eyebrow"
                >{m.fin_inv_eyebrow({ number: inv.number ?? inv.documentId ?? '—' })}</span
              >
              <div class="total" class:struck={isVoid}>
                <span class="total-sym">{sym.trim()}</span>
                <span class="total-num"
                  >{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span
                >
              </div>
              {#if crmContactId}
                <a class="client client-link" href={`/crm/${crmContactId}`}>
                  {inv.clientName ?? '—'}<ExternalLink size={13} class="client-ico" />
                </a>
              {:else}
                <span class="client">{inv.clientName ?? '—'}</span>
              {/if}
              <span class="trust">
                {#if inv.seller}
                  {m.fin_inv_issued_by({ date: fmtDate(inv.issuedAt), seller: inv.seller })}
                {:else}
                  {m.fin_inv_issued_on({ date: fmtDate(inv.issuedAt) })}
                {/if}
              </span>
            </div>

            <!-- Payment state IS the status here — no separate status pill (it just
					     repeated "Paid"). Void is signalled by the banner + struck total. -->
            {#if !isVoid}
              <div class="hero-aside">
                {#if payState === 'full'}
                  <div class="pay-badge full">
                    <Check size={15} />
                    <span class="pay-title">{m.fin_inv_paid_in_full()}</span>
                    <span class="pay-sub">{m.fin_inv_received({ amount: money(paid) })}</span>
                  </div>
                {:else if payState === 'partial'}
                  <div class="pay-badge partial">
                    <AlertTriangle size={14} />
                    <span class="pay-title">{m.fin_inv_owed({ amount: money(outstanding) })}</span>
                    <span class="pay-sub"
                      >{m.fin_inv_paid_of_total({ paid: money(paid), total: money(total) })}</span
                    >
                  </div>
                {:else}
                  <div class="pay-badge unpaid">
                    <AlertTriangle size={14} />
                    <span class="pay-title">{m.fin_inv_unpaid_owed({ amount: money(total) })}</span>
                  </div>
                {/if}
                {#if statusMismatch}
                  <span class="mismatch"
                    ><AlertTriangle size={11} /> {m.fin_inv_status_mismatch()}</span
                  >
                {/if}
              </div>
            {/if}
          </div>

          <!-- Secondary fields (empty/zero skipped), separated from the hero head. -->
          {#if hasMeta}
            <div class="meta">
              {#if methods.length}
                <div class="meta-item">
                  <span class="meta-l">{m.fin_inv_method()}</span><span class="meta-v capitalize"
                    >{methods.join(', ')}</span
                  >
                </div>
              {/if}
              {#if hasVal(inv.clientDocNumber)}
                <div class="meta-item">
                  <span class="meta-l">{m.fin_col_dni()}</span><span class="meta-v dim"
                    >{inv.clientDocNumber}</span
                  >
                </div>
              {/if}
              {#if subtotalMeaningful}
                <div class="meta-item">
                  <span class="meta-l">{m.fin_col_subtotal()}</span><span class="meta-v"
                    >{money(inv.subtotal)}</span
                  >
                </div>
              {/if}
              {#if taxNonZero}
                <div class="meta-item">
                  <span class="meta-l">{m.fin_col_tax()}</span><span class="meta-v"
                    >{money(inv.tax)}</span
                  >
                </div>
              {/if}
              {#if discountNonZero}
                <div class="meta-item discount">
                  <span class="meta-l">{m.fin_col_discount()}</span><span class="meta-v"
                    >{money(inv.discount)}</span
                  >
                </div>
              {/if}
              {#if hasVal(inv.note)}
                <div class="meta-item">
                  <span class="meta-l">{m.fin_col_note()}</span><span class="meta-v note"
                    >{inv.note}</span
                  >
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Items -->
        {#if items.length > 0}
          <section class="doc-sec">
            <header class="panel-h">{m.fin_invoice_items()}</header>
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-left t-caption border-b border-[var(--hairline)]">
                  <th class="px-3 py-2 font-medium">{m.fin_col_description()}</th>
                  <th class="px-3 py-2 font-medium text-right">{m.fin_col_qty()}</th>
                  <th class="px-3 py-2 font-medium text-right">{m.fin_col_unit_price()}</th>
                  <th class="px-3 py-2 font-medium text-right">{m.fin_col_discount()}</th>
                  <th class="px-3 py-2 font-medium text-right">{m.fin_col_total()}</th>
                </tr>
              </thead>
              <tbody>
                {#each items as it (it.id)}
                  <tr class="border-b border-[var(--hairline)]">
                    <td class="px-3 py-2">{it.description ?? it.code ?? '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{it.quantity ?? '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{money(it.unitPrice)}</td>
                    <td class="px-3 py-2 text-right tabular-nums"
                      >{numVal(it.discount) > 0 ? money(it.discount) : ''}</td
                    >
                    <td class="px-3 py-2 text-right tabular-nums font-semibold"
                      >{money(it.total)}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}

        <!-- Payments -->
        {#if payments.length > 0}
          <section class="doc-sec">
            <header class="panel-h">{m.fin_invoice_payments()}</header>
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-left t-caption border-b border-[var(--hairline)]">
                  <th class="px-3 py-2 font-medium">{m.fin_col_paid_at()}</th>
                  <th class="px-3 py-2 font-medium">{m.fin_col_method()}</th>
                  <th class="px-3 py-2 font-medium text-right">{m.fin_col_amount()}</th>
                  <th class="px-3 py-2 font-medium">{m.fin_col_status()}</th>
                </tr>
              </thead>
              <tbody>
                {#each payments as p (p.id)}
                  <tr
                    class="border-b border-[var(--hairline)]"
                    class:void-row={p.status === 'void'}
                  >
                    <td class="px-3 py-2 t-caption">{fmtDate(p.paidAt)}</td>
                    <td class="px-3 py-2 capitalize">{p.method ?? '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-medium">{money(p.amount)}</td>
                    <td class="px-3 py-2"
                      ><span class="status-pill sm" data-status={p.status ?? ''}
                        >{p.status ?? '—'}</span
                      ></td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if payState === 'full'}
              <div class="received">{m.fin_inv_received_caption({ amount: money(paid) })}</div>
            {/if}
          </section>
        {/if}

        <!-- Stock -->
        {#if data.stockEnabled}
          <section class="doc-sec">
            <header class="panel-h">{m.fin_stock_section_title()}</header>
            {#if stockEntry && stockStatusV}
              <a class="stock-link" href={`/stock/entries/${stockEntry.id}`}>
                <Boxes size={14} />
                <span>{stockEntry.humanId ?? stockEntry.id.slice(0, 8)}</span>
                <Badge variant={stockStatusV.variant} value={stockStatusV.value}>
                  {stockEntry.status === 'draft'
                    ? m.stock_status_draft()
                    : stockEntry.status === 'submitted'
                      ? m.stock_status_submitted()
                      : m.stock_status_cancelled()}
                </Badge>
                <ExternalLink size={12} class="stock-link-ico" />
              </a>
            {:else}
              <div class="flex items-center justify-between gap-3">
                <p class="t-caption">{m.fin_stock_no_issue()}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={openIssueDialog}
                  disabled={!canAct('stock', 'create')}
                  title={canAct('stock', 'create') ? undefined : m.no_permission()}
                >
                  <Boxes size={14} />
                  {m.fin_stock_create_issue()}
                </Button>
              </div>
            {/if}
          </section>
        {/if}
      </div>

      {#if hasVal(inv.documentId)}
        <div class="doc-foot">{m.fin_inv_doc({ id: inv.documentId ?? '' })}</div>
      {/if}
    </div>
  </PageBody>
</PageShell>

<Modal bind:open={issueDialogOpen} title={m.fin_stock_create_issue()} size="lg">
  <div class="flex flex-col gap-3">
    <Select
      size="sm"
      label={m.stock_field_warehouse()}
      bind:value={issueWarehouseId}
      onchange={loadPreview}
    >
      <option value="">{m.fin_stock_select_warehouse()}</option>
      {#each data.stockWarehouses as w (w.id)}
        <option value={w.id}>{w.name}</option>
      {/each}
    </Select>

    {#if previewBusy}
      <p class="t-caption">{m.common_loading()}</p>
    {:else if previewLines.length > 0}
      <table class="mini-table">
        <thead>
          <tr>
            <th>{m.stock_field_item()}</th>
            <th class="num">{m.stock_field_qty()}</th>
            <th class="num">{m.fin_stock_available()}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each previewLines as l, i (l.itemId)}
            {@const gMax = lineGaugeMax(l)}
            <tr>
              <td>{l.itemCode} — {l.itemName}</td>
              <td class="num">
                <div class="qty-cell">
                  <input
                    class="inp w-20 text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    bind:value={() => l.qty, (v) => setLineQty(l, v)}
                  />
                  {#if gMax > 0}
                    <ConsumptionGauge
                      class="compact"
                      max={gMax}
                      unit={l.consumptionUom ?? l.uom}
                      bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
                    />
                  {/if}
                </div>
                {#if gMax > 0 && l.qtyConsumption != null}
                  <div class="t-caption conversion-caption">
                    {m.fin_stock_line_conversion({
                      consumptionQty: fmtQty(l.qtyConsumption),
                      consumptionUom: l.consumptionUom ?? '',
                      stockQty: fmtQty(Number(l.qty)),
                      stockUom: l.uom,
                    })}
                  </div>
                {/if}
              </td>
              <td class="num t-caption">{l.available != null ? `${l.available} ${l.uom}` : '—'}</td>
              <td>
                <Button
                  variant="ghost"
                  size="sm"
                  class="invoice-line-remove"
                  aria-label="Remove line"
                  onclick={() => removePreviewLine(i)}
                >
                  <Trash2 size={13} />
                </Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if issueWarehouseId}
      <p class="t-caption">{m.fin_stock_preview_empty()}</p>
    {/if}

    {#if issueWarehouseId && !previewBusy}
      <div class="add-line-form">
        <Combobox
          id="issue-add-item"
          items={data.stockItems}
          itemToValue={(i) => i.id}
          itemToString={(i) => `${i.code} — ${i.name}`}
          placeholder={m.stock_field_item()}
          bind:value={addItemId}
        />
        <input
          class="inp w-20 text-right"
          type="number"
          min="0"
          step="0.01"
          placeholder={m.stock_field_qty()}
          bind:value={addQty}
        />
        <Button variant="outline" size="sm" onclick={addPreviewLine} disabled={!canAddLine}
          >{m.stock_add_line()}</Button
        >
      </div>
    {/if}

    {#if unmatched.length > 0}
      <p class="t-caption unmatched-note">
        {m.fin_stock_unmatched({ items: unmatched.map((u) => u.description).join(', ') })}
      </p>
    {/if}

    {#if issueErr}<p class="err-msg">{issueErr}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (issueDialogOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button
      variant="outline"
      size="sm"
      onclick={() => saveIssue(false)}
      disabled={issueBusy || previewLines.length === 0}>{m.stock_save_draft()}</Button
    >
    <Button
      variant="primary"
      size="sm"
      onclick={() => saveIssue(true)}
      disabled={issueBusy || previewLines.length === 0}>{m.stock_submit()}</Button
    >
  {/snippet}
</Modal>

<style>
  .void-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-destructive);
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
    font-weight: 700;
    font-size: var(--font-size-page-title, 18px);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  /* Void: the banner + struck total carry the signal; keep the rest readable. */
  .content.voided {
    opacity: 0.82;
  }

  /* The invoice document — one bordered card; inner sections divided by hairlines. */
  .doc {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    overflow: hidden;
  }

  /* Hero = the document's head section (no own border/radius — part of .doc). */
  .hero {
    display: flex;
    flex-direction: column;
    padding: var(--space-section, 24px) var(--space-section, 24px);
  }
  .hero-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-section, 24px);
  }
  .hero-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    min-width: 0;
  }
  .eyebrow {
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-muted-foreground);
  }
  .total {
    display: flex;
    align-items: baseline;
    gap: var(--space-1, 4px);
    line-height: 1;
  }
  .total-sym {
    font-size: var(--font-size-display, 28px);
    font-weight: 500;
    color: var(--color-muted-foreground);
  }
  .total-num {
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    color: var(--color-foreground);
    font-variant-numeric: tabular-nums;
  }
  .total.struck {
    text-decoration: line-through;
  }
  .total.struck .total-num,
  .total.struck .total-sym {
    color: var(--color-muted-foreground);
  }
  .client {
    font-size: var(--font-size-page-title, 18px);
    font-weight: 600;
    color: var(--color-foreground);
    margin-top: var(--space-1, 4px);
  }
  .client-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    color: var(--color-accent);
    width: fit-content;
  }
  .client-link:hover {
    text-decoration: underline;
  }
  :global(.client-link .client-ico) {
    opacity: 0.6;
  }
  .trust {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
  }

  .hero-aside {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2, 8px);
  }
  .pay-badge {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-0-5, 2px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border-radius: var(--radius-md);
    text-align: right;
  }
  .pay-badge :global(svg) {
    margin-bottom: var(--space-0-5, 2px);
  }
  .pay-title {
    font-weight: 700;
    font-size: var(--font-size-page-title, 18px);
    font-variant-numeric: tabular-nums;
  }
  .pay-sub {
    font-size: var(--font-size-body, 14px);
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }
  .pay-badge.full {
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
  }
  .pay-badge.partial {
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  }
  .pay-badge.unpaid {
    color: var(--color-destructive);
    background: color-mix(in srgb, var(--color-destructive) 13%, transparent);
  }
  .mismatch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-warning);
  }

  /* Meta strip — folded into the hero card, separated by a hairline. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3, 12px) var(--space-8, 32px);
    margin-top: var(--space-4, 16px);
    padding-top: var(--space-4, 16px);
    border-top: 1px solid var(--hairline);
  }
  .meta-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
  }
  .meta-l {
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .meta-v {
    font-size: var(--font-size-body, 14px);
    color: var(--color-foreground);
    font-variant-numeric: tabular-nums;
  }
  .meta-v.dim {
    color: var(--color-muted-foreground);
  }
  .meta-v.note {
    font-style: italic;
    color: var(--color-muted-foreground);
  }
  .meta-item.discount {
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  }
  .meta-item.discount .meta-l,
  .meta-item.discount .meta-v {
    color: var(--color-warning);
    font-weight: 600;
  }

  /* Document sections (items, payments) — divided from the section above by a
	   full-width hairline; no own border/radius/background (one continuous doc). */
  .doc-sec {
    border-top: 1px solid var(--hairline);
    padding: var(--space-4, 16px) var(--space-section, 24px);
    overflow-x: auto;
  }
  /* Align table edges to the section padding (1.5rem) — same gutter as the hero. */
  .doc-sec :global(th:first-child),
  .doc-sec :global(td:first-child) {
    padding-left: 0;
  }
  .doc-sec :global(th:last-child),
  .doc-sec :global(td:last-child) {
    padding-right: 0;
  }
  .panel-h {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-2, 8px);
  }
  .void-row {
    text-decoration: line-through;
    color: var(--color-muted-foreground);
  }
  .received {
    margin-top: var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    color: var(--color-success);
  }
  .doc-foot {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    padding: 0 var(--space-1);
    margin-top: var(--space-2, 8px);
  }

  /* Status pill */
  .status-pill {
    display: inline-block;
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border-radius: var(--radius-full);
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    text-transform: capitalize;
    background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
    color: var(--color-muted-foreground);
  }
  .status-pill.sm {
    font-size: var(--font-size-caption, 12px);
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    font-weight: 500;
  }
  .status-pill[data-status='paid'] {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
  }
  .status-pill[data-status='partial'] {
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
    color: var(--color-warning);
  }
  .status-pill[data-status='void'] {
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
  }

  /* Stock card */
  .stock-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    color: var(--color-foreground);
  }
  .stock-link:hover {
    color: var(--color-accent);
  }
  :global(.stock-link .stock-link-ico) {
    opacity: 0.6;
  }

  /* Stock issue dialog */
  .mini-table {
    width: 100%;
    font-size: var(--font-size-body, 14px);
    border-collapse: collapse;
  }
  .mini-table th {
    text-align: left;
    font-weight: 500;
    color: var(--color-muted-foreground);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border-bottom: 1px solid var(--hairline);
  }
  .mini-table td {
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border-bottom: 1px solid var(--hairline);
  }
  .mini-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .inp {
    height: 1.75rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .qty-cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2, 8px);
  }
  .conversion-caption {
    text-align: right;
    margin-top: var(--space-1, 4px);
  }
  :global(.invoice-line-remove) {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  :global(.invoice-line-remove:hover) {
    color: var(--color-destructive);
  }
  .unmatched-note {
    font-style: italic;
  }
  .add-line-form {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--space-2, 8px);
    align-items: end;
  }
  .err-msg {
    font-size: var(--font-size-body, 14px);
    color: var(--color-destructive);
  }
</style>
