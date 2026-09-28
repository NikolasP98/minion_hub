<script lang="ts">
  /**
   * Read-only POS ticket record — the page the appointment drawer's payment
   * chip and its hover card open. A POS ticket is only bridged to
   * `fin_invoices` once `invoice_provider_ref` is set, so "Open invoice" is
   * conditional: for most tickets THIS is the document.
   *
   * Layout mirrors `/sales/[id]` (record-detail shell, `.card` / `.kv` classes).
   */
  import type { PageData } from './$types';
  import { PageHeader, Button, Badge, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { ArrowLeft } from 'lucide-svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
  const t = $derived(data.ticket);
  const cur = $derived(t.currency || 'PEN');
  const back = createBackNav('/pos/sell', m.pos_ticket_back);

  type Line = PageData['lines'][number];
  type Payment = PageData['payments'][number];

  const voided = $derived(t.status === 'voided');
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
    { key: 'method', label: m.fin_col_method(), sortable: false, cellClass: 'capitalize' },
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
      <Badge variant="semantic" value={voided ? 'error' : 'success'}>
        {voided ? m.pos_ticket_status_voided() : m.pos_ticket_status_submitted()}
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
              {#if col.key === 'amount'}
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

      {#if data.emissions.length > 0}
        <section class="card">
          <header class="card-h"><span>{m.pos_ticket_section_sunat()}</span></header>
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

      <section class="card">
        <header class="card-h"><span>{m.pos_ticket_section_about()}</span></header>
        <dl class="kv">
          <div>
            <dt>{m.pos_ticket_customer()}</dt>
            <dd>
              {#if t.crmContactId}
                <a class="link" href={`/crm/${t.crmContactId}`}>{t.customerName ?? '—'}</a>
              {:else}
                {t.customerName ?? '—'}
              {/if}
            </dd>
          </div>
          {#if data.createdByName}
            <div>
              <dt>{m.pos_ticket_cashier()}</dt>
              <dd>{data.createdByName}</dd>
            </div>
          {/if}
          {#if t.note}
            <div>
              <dt>{m.fin_col_note()}</dt>
              <dd>{t.note}</dd>
            </div>
          {/if}
        </dl>
        {#if data.invoiceId}
          <a class="t-caption link" href={`/finances/invoices/${data.invoiceId}`}
            >{m.pos_ticket_open_invoice()} →</a
          >
        {/if}
      </section>
    </div>
  </PageBody>
</PageShell>

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
