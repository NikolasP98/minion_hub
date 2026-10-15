<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { Badge } from '$lib/components/ui';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import PaymentSummaryTable from './PaymentSummaryTable.svelte';

  type Ticket = PageData['tickets'][number];
  type Shift = PageData['shifts'][number];

  /**
   * One shift's own summary + ticket table — the block a nested shift row
   * expands into on /pos/history, and the SAME block the month view's day
   * Sheet renders per shift that had payments that day. One place, both
   * callers (owner 2026-10-15).
   */
  let {
    shift,
    tickets,
    methodTotals,
    search = '',
  }: {
    shift: Shift;
    tickets: Ticket[];
    methodTotals: Record<string, number>;
    search?: string;
  } = $props();

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Net of voided tickets — same reading the parent shifts table's Total
  // column uses.
  const total = $derived(
    tickets.reduce((sum, t) => (t.status === 'void' ? sum : sum + Number(t.total)), 0),
  );
  const expected = $derived(
    shift.closedAt ? (shift.expected as Record<string, number> | null) : null,
  );
  const counted = $derived(shift.counted as Record<string, number> | null);

  const ticketColumns = $derived<DataColumn<Ticket>[]>([
    { key: 'date', label: m.pos_history_col_date(), custom: true, accessor: (t) => t.submittedAt },
    {
      key: 'customer',
      label: m.pos_sell_customer(),
      accessor: (t) => t.customerName ?? m.pos_pay_walk_in(),
    },
    {
      key: 'total',
      label: m.pos_sell_total(),
      money: true,
      custom: true,
      align: 'right',
      accessor: (t) => t.total,
    },
    { key: 'status', label: m.pos_history_col_status(), custom: true, accessor: (t) => t.status },
    { key: 'cashier', label: m.pos_ticket_cashier(), accessor: (t) => t.cashier ?? '—' },
    {
      key: 'methods',
      label: m.fin_col_method(),
      custom: true,
      sortable: false,
      accessor: (t) => t.payments.map((p) => p.method).join(', '),
    },
  ]);
</script>

{#snippet totalCell(t: Ticket)}
  <span class="tabular-nums">{formatMoney(Number(t.total))}</span>
{/snippet}
{#snippet dateCell(t: Ticket)}
  <span class="tabular-nums">{fmtTime(t.submittedAt)}</span>
{/snippet}
{#snippet statusCell(t: Ticket)}
  {#if t.status === 'void'}
    <Badge variant="semantic" value="error" size="sm">{m.pos_ticket_status_voided()}</Badge>
  {:else}
    <Badge variant="semantic" value="success" size="sm">{m.pos_ticket_status_submitted()}</Badge>
  {/if}
{/snippet}
{#snippet methodsCell(t: Ticket)}
  <div class="diffs">
    {#each t.payments as p, i (i)}
      <Badge variant="neutral" size="sm">
        <span class="capitalize">{p.method}</span>
        {#if t.payments.length > 1}<span class="tabular-nums">{formatMoney(p.amount)}</span>{/if}
      </Badge>
    {:else}
      <span class="dim">—</span>
    {/each}
  </div>
{/snippet}

<div class="shift-detail">
  <PaymentSummaryTable {total} {methodTotals} {expected} {counted} />
  <DataTable
    class="shift-table"
    columns={ticketColumns}
    data={tickets}
    getRowId={(t) => t.id}
    {search}
    searchFields={(t) => `${t.humanId ?? ''} ${t.customerName ?? ''} ${t.cashier ?? ''}`}
    storageKey="pos-history-tickets"
    chrome={false}
    canEdit={false}
    idColumn={{ value: (t) => t.humanId ?? t.id.slice(0, 8) }}
    titleColumn={{ key: 'customer', href: (t) => `/pos/tickets/${t.id}` }}
    emptyMessage={m.pos_history_empty_tickets()}
    cells={{ date: dateCell, status: statusCell, methods: methodsCell, total: totalCell }}
    footer
    initialAggregates={{ date: ['count'], total: ['sum'] }}
    initialSort={{ key: 'date', dir: 'desc' }}
  />
</div>

<style>
  .shift-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .diffs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }
  .shift-detail :global(.shift-table) {
    border-top: 1px solid var(--color-border);
  }
</style>
