<script lang="ts">
  import type { PageData } from './$types';
  import { History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, iconSizes, Tabs, type TabItem } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import { moneyDraft, remainingMoneyState } from '$lib/components/pos/checkout-money';

  let { data }: { data: PageData } = $props();
  type Ticket = PageData['tickets'][number];
  type Shift = PageData['shifts'][number];

  let tab = $state('tickets');
  const tabs = $derived<TabItem[]>([
    { value: 'tickets', label: m.pos_history_tab_tickets(), count: data.tickets.length },
    { value: 'shifts', label: m.pos_history_tab_shifts(), count: data.shifts.length },
  ]);

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
    {
      key: 'shift',
      label: m.pos_history_col_shift(),
      custom: true,
      accessor: (t) => shiftLabel(t.shiftId),
    },
  ]);

  const shiftColumns = $derived<DataColumn<Shift>[]>([
    {
      key: 'opened',
      label: m.pos_history_col_opened(),
      custom: true,
      accessor: (s) => s.openedAt,
    },
    {
      key: 'closed',
      label: m.pos_history_col_closed(),
      custom: true,
      accessor: (s) => s.closedAt,
    },
    {
      key: 'diff',
      label: m.pos_shift_difference(),
      custom: true,
      sortable: false,
      accessor: () => null,
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

{#snippet openedCell(s: Shift)}
  <span class="tabular-nums">{fmtTime(s.openedAt)}</span>
{/snippet}
{#snippet closedCell(s: Shift)}
  {#if s.closedAt}
    <span class="tabular-nums">{fmtTime(s.closedAt)}</span>
  {:else}
    <Badge variant="semantic" value="info" size="sm">{m.pos_sell_shift_status_open()}</Badge>
  {/if}
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
    <Tabs id="pos-history-tabs" aria-label={m.a11y_tabs_pos_history()} {tabs} bind:value={tab} />

    <div
      id={`pos-history-tabs-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`pos-history-tabs-tab-${tab}`}
      class="panel"
    >
      {#if tab === 'tickets'}
        <DataTable
          class="flex-1 min-h-0"
          columns={ticketColumns}
          data={data.tickets}
          getRowId={(t) => t.id}
          searchPlaceholder={m.data_table_search()}
          searchFields={(t) => `${t.humanId ?? ''} ${t.customerName ?? ''}`}
          storageKey="pos-history-tickets"
          canEdit={false}
          idColumn={{ value: (t) => t.humanId ?? t.id.slice(0, 8) }}
          titleColumn={{ key: 'customer', href: (t) => `/pos/tickets/${t.id}` }}
          emptyMessage={m.pos_history_empty_tickets()}
          cells={{ date: dateCell, status: statusCell, shift: shiftCell }}
          initialSort={{ key: 'date', dir: 'desc' }}
        />
      {:else}
        <DataTable
          class="flex-1 min-h-0"
          columns={shiftColumns}
          data={data.shifts}
          getRowId={(s) => s.id}
          canEdit={false}
          emptyMessage={m.pos_history_empty_shifts()}
          cells={{ opened: openedCell, closed: closedCell, diff: diffCell }}
          initialSort={{ key: 'opened', dir: 'desc' }}
        />
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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
