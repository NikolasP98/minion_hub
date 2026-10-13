<script lang="ts">
  import type { PageData } from './$types';
  import { History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import type { GroupSpec } from '$lib/components/data-table/group-by';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import { moneyDraft, remainingMoneyState } from '$lib/components/pos/checkout-money';

  let { data }: { data: PageData } = $props();
  type Ticket = PageData['tickets'][number];
  type Shift = PageData['shifts'][number];

  // One table: tickets, with the per-shift summary as the group header when
  // grouped by shift (the former "Shifts" tab). Grouped by default so the
  // shift summary is one glance away; "Flat" is the plain ticket list.
  // shortcut: a shift with no tickets has no bucket and is not listed,
  // upgrade when an empty open shift needs to show here.
  let groupValue = $state('shift');
  const shiftById = $derived(new Map(data.shifts.map((s) => [s.id, s])));
  const shiftGroup = $derived<GroupSpec<Ticket> | undefined>(
    groupValue === 'shift'
      ? {
          of: (t) => t.shiftId,
          order: (a, b) =>
            new Date(shiftById.get(b)?.openedAt ?? 0).getTime() -
            new Date(shiftById.get(a)?.openedAt ?? 0).getTime(),
        }
      : undefined,
  );

  // `total` is a Postgres numeric (string); same per-row Number() coercion the
  // DataTable's own money aggregate uses. Voided tickets don't count.
  const shiftTotal = (rows: Ticket[]) =>
    rows.reduce((sum, t) => (t.status === 'void' ? sum : sum + Number(t.total)), 0);
  /** Non-void income per payment method across the grouped tickets. */
  function shiftByMethod(rows: Ticket[]): [string, number][] {
    const sums = new Map<string, number>();
    for (const t of rows) {
      if (t.status === 'void') continue;
      for (const p of t.payments) sums.set(p.method, (sums.get(p.method) ?? 0) + p.amount);
    }
    return [...sums];
  }

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Tickets have no human shift reference (shifts aren't numbered) — the
  // shift's own open time doubles as its label here, same as the shift tab.
  const shiftLabel = (shiftId: string) => {
    const s = data.shifts.find((sh) => sh.id === shiftId);
    return s ? fmtTime(s.openedAt) : '—';
  };

  function shiftDifference(
    counted: number,
    expected: number,
  ): { value: number | null; balanced: boolean } {
    const countedMoney = moneyDraft(counted, { exact: true });
    const expectedMoney = moneyDraft(expected, { exact: true });
    if (!countedMoney.ok || !expectedMoney.ok) return { value: null, balanced: false };
    const difference = remainingMoneyState(countedMoney.value.minor, expectedMoney.value.minor);
    return difference.ok
      ? { value: difference.value.number, balanced: difference.value.minor === 0n }
      : { value: null, balanced: false };
  }

  const ticketColumns = $derived<DataColumn<Ticket>[]>([
    {
      key: 'date',
      label: m.pos_history_col_date(),
      custom: true,
      accessor: (t) => t.submittedAt,
    },
    {
      key: 'customer',
      label: m.pos_sell_customer(),
      accessor: (t) => t.customerName ?? m.pos_pay_walk_in(),
    },
    {
      key: 'total',
      label: m.pos_sell_total(),
      money: true,
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
    {
      key: 'shift',
      label: m.pos_history_col_shift(),
      custom: true,
      accessor: (t) => shiftLabel(t.shiftId),
    },
  ]);
</script>

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
{#snippet shiftCell(t: Ticket)}
  <span class="tabular-nums dim">{shiftLabel(t.shiftId)}</span>
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

{#snippet groupRow(key: string, rows: Ticket[])}
  {@const s = shiftById.get(key)}
  <span class="shift-title">
    <span class="t-title tabular-nums">{s ? fmtTime(s.openedAt) : '—'}</span>
    {#if !s?.closedAt}
      <Badge variant="semantic" value="info" size="sm">{m.pos_sell_shift_status_open()}</Badge>
    {:else}
      <span class="dim tabular-nums">→ {fmtTime(s.closedAt)}</span>
    {/if}
    {#if s?.openedByName}<span class="dim">· {s.openedByName}</span>{/if}
  </span>
  <span class="shift-totals t-caption">
    <span>{m.pos_history_group_ticket_count({ count: rows.length })}</span>
    <span class="tabular-nums">{formatMoney(shiftTotal(rows))}</span>
    {#each shiftByMethod(rows) as [method, amount] (method)}
      <span class="tabular-nums"
        ><span class="capitalize">{method}</span> {formatMoney(amount)}</span
      >
    {/each}
    {#if s}{@render diffCell(s)}{/if}
  </span>
{/snippet}
{#snippet diffCell(s: Shift)}
  {#if s.expected}
    <div class="diffs">
      {#each Object.keys(s.expected as Record<string, number>) as mth (mth)}
        {@const exp = (s.expected as Record<string, number>)[mth] ?? 0}
        {@const cnt = (s.counted as Record<string, number> | null)?.[mth] ?? 0}
        {@const diff = shiftDifference(cnt, exp)}
        <Badge variant="semantic" value={diff.balanced ? 'success' : 'warning'} size="sm">
          {mth}: {diff.value == null ? '—' : formatMoney(diff.value)}
        </Badge>
      {/each}
    </div>
  {:else}
    <span class="dim">—</span>
  {/if}
{/snippet}

<svelte:head><title>{m.pos_history_title()} — {m.nav_pos()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="pos-history-title">
  <PageHeader
    titleId="pos-history-title"
    title={m.pos_history_title()}
    subtitle={m.pos_history_subtitle()}
  >
    {#snippet leading()}<History size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    <DataTable
      class="flex-1 min-h-0"
      columns={ticketColumns}
      data={data.tickets}
      getRowId={(t) => t.id}
      searchPlaceholder={m.data_table_search()}
      searchFields={(t) => `${t.humanId ?? ''} ${t.customerName ?? ''} ${t.cashier ?? ''}`}
      storageKey="pos-history-tickets"
      canEdit={false}
      idColumn={{ value: (t) => t.humanId ?? t.id.slice(0, 8) }}
      titleColumn={{ key: 'customer', href: (t) => `/pos/tickets/${t.id}` }}
      emptyMessage={m.pos_history_empty_tickets()}
      cells={{ date: dateCell, status: statusCell, shift: shiftCell, methods: methodsCell }}
      footer
      initialAggregates={{ date: ['count'], total: ['sum'] }}
      initialSort={{ key: 'date', dir: 'desc' }}
      groupBy={shiftGroup}
      groupOptions={[{ value: 'shift', label: m.pos_history_col_shift() }]}
      bind:groupValue
      groupNoneLabel={m.catalog_group_none()}
      {groupRow}
    />
  </PageBody>
</PageShell>

<style>
  .shift-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .shift-totals {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-left: var(--space-3);
    color: var(--color-text-secondary);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .diffs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }
</style>
