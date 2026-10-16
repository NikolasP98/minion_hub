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
  import type { PageData } from './$types';
  import { PageHeader, Button, Badge, Modal, Select, iconSizes } from '$lib/components/ui';
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
        <header class="card-h"><span>{m.pos_ticket_section_lines()}</span></header>
        <DataTable variant="plain" data={data.lines} columns={lineColumns} getRowId={(l) => l.id}>
          {#snippet cell(row: Line, col: DataColumn<Line>)}
            {#if col.key === 'description'}
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
                {row.description}
              {/if}
            {:else if col.key === 'unitPrice'}
              {money(row.unitPrice)}
            {:else if col.key === 'discount'}
              {nonZero(row.discount) ? money(row.discount) : ''}
            {:else if col.key === 'total'}
              {money(row.total)}
            {/if}
          {/snippet}
        </DataTable>
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
