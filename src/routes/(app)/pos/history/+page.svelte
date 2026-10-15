<script lang="ts">
  import type { PageData } from './$types';
  import { History, Search, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    PageHeader,
    Badge,
    Button,
    Input,
    SegmentedControl,
    EmptyState,
    iconSizes,
  } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import { moneyDraft, remainingMoneyState } from '$lib/components/pos/checkout-money';
  import { dayTotals } from './payments-fold';
  import {
    calendarDays,
    shiftCalendarDate,
    todayIn,
  } from '$lib/components/scheduling/calendar-window';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';

  let { data }: { data: PageData } = $props();
  type Ticket = PageData['tickets'][number];
  type Shift = PageData['shifts'][number];
  type View = PageData['view'];

  // Page-level search: filters every shift's own table (DataTable's `search`
  // prop still runs its filter pipeline with `chrome={false}` — only the
  // input UI is suppressed there).
  let pageSearch = $state('');

  // ── View + focused day. Mirrored in `?view=`/`?date=` like /pos/appointments,
  // but shallow: every payment a calendar view needs is already in
  // `data.payments` (same 500-row window as the ticket list), so changing the
  // day never needs a server round trip. Independently mutable from here on —
  // deriving them from `data` would snap back to the URL's initial values on
  // every unrelated invalidation. ──
  // svelte-ignore state_referenced_locally
  let view = $state<View>(data.view);
  // svelte-ignore state_referenced_locally
  let day = $state(data.day);

  function syncUrl(nextView: View, nextDay: string) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('view', nextView);
    params.set('date', nextDay);
    replaceState(`${page.url.pathname}?${params}`, {});
  }
  function setView(next: string) {
    view = next as View;
    syncUrl(view, day);
  }
  function step(delta: number) {
    day = shiftCalendarDate(day, view === 'month' ? 'month' : 'week', delta);
    syncUrl(view, day);
  }
  function goToday() {
    day = todayIn(data.orgTz);
    syncUrl(view, day);
  }

  const viewItems = [
    { value: 'list', label: m.pos_history_view_list() },
    { value: 'week', label: m.cal_view_week() },
    { value: 'month', label: m.cal_view_month() },
  ];

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  // `total` is a Postgres numeric (string); same per-row Number() coercion the
  // DataTable's own money aggregate uses. Voided tickets don't count.
  const shiftTotal = (rows: Ticket[]) =>
    rows.reduce((sum, t) => (t.status === 'void' ? sum : sum + Number(t.total)), 0);

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

  // Tickets grouped by shift, in `data.shifts`' own order (newest-first).
  // Shifts with no tickets have no section — the former "Flat" toggle is
  // gone, so there is no other view that would need them listed empty.
  const ticketsByShift = $derived.by(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of data.tickets) map.set(t.shiftId, [...(map.get(t.shiftId) ?? []), t]);
    return map;
  });
  const shiftSections = $derived(data.shifts.filter((s) => ticketsByShift.has(s.id)));

  // Open-by-default: the shift still open, else the newest one. Computed once
  // from the initial load — later ticket/shift changes don't re-collapse
  // whatever the operator already opened.
  const initialOpenId = (() => {
    const byShift = new Map<string, unknown>();
    for (const t of data.tickets) byShift.set(t.shiftId, true);
    const sections = data.shifts.filter((s) => byShift.has(s.id));
    return sections.find((s) => !s.closedAt)?.id ?? sections[0]?.id ?? null;
  })();
  let openShifts = $state<Set<string>>(new Set(initialOpenId ? [initialOpenId] : []));
  function toggleShift(id: string) {
    const next = new Set(openShifts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openShifts = next;
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
  ]);

  // ── Week / month calendar views ──
  const dayFolds = $derived(dayTotals(data.payments, data.orgTz));
  const calendarDayKeys = $derived(view === 'list' ? [] : calendarDays(day, view));
  const MAX_DAY_METHODS = 4;
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

{#snippet sectionHeader(s: Shift, rows: Ticket[])}
  {@const open = openShifts.has(s.id)}
  <div class="shift-header">
    <Button
      variant="ghost"
      size="xs"
      class="shift-toggle{open ? ' open' : ''}"
      aria-label={open ? m.data_table_collapse() : m.data_table_expand()}
      aria-expanded={open}
      onclick={() => toggleShift(s.id)}
    >
      <ChevronRight size={iconSizes.sm} />
    </Button>
    <span class="shift-title">
      <span class="t-title tabular-nums">{fmtTime(s.openedAt)}</span>
      {#if !s.closedAt}
        <Badge variant="semantic" value="info" size="sm">{m.pos_sell_shift_status_open()}</Badge>
      {:else}
        <span class="dim tabular-nums">→ {fmtTime(s.closedAt)}</span>
      {/if}
      {#if s.openedByName}<span class="dim">· {s.openedByName}</span>{/if}
    </span>
    <span class="dim t-caption">{m.pos_history_group_ticket_count({ count: rows.length })}</span>
    <span class="tabular-nums t-caption">{formatMoney(shiftTotal(rows))}</span>
  </div>
{/snippet}

{#snippet summaryTable(s: Shift, rows: Ticket[])}
  {@const methodTotals = Object.entries(data.methodTotals[s.id] ?? {})}
  {@const expected = s.closedAt ? (s.expected as Record<string, number> | null) : null}
  <table class="shift-summary">
    <caption class="sr-only">{m.pos_history_group_ticket_count({ count: rows.length })}</caption>
    <thead>
      <tr>
        <th scope="col" class="sr-only">{m.fin_col_method()}</th>
        <th scope="col" class="sr-only">{m.pos_history_summary_amount()}</th>
      </tr>
    </thead>
    <tbody>
      <tr class="total-row">
        <td>{m.pos_sell_total()}</td>
        <td class="num tabular-nums">{formatMoney(shiftTotal(rows))}</td>
      </tr>
      {#each methodTotals as [method, amount] (method)}
        <tr>
          <td class="capitalize">{method}</td>
          <td class="num tabular-nums">{formatMoney(amount)}</td>
        </tr>
      {/each}
      {#if expected}
        {#each Object.keys(expected) as mth (mth)}
          {@const exp = expected[mth] ?? 0}
          {@const cnt = (s.counted as Record<string, number> | null)?.[mth] ?? 0}
          {@const diff = shiftDifference(cnt, exp)}
          <tr class="diff-row">
            <td class="capitalize">{mth}</td>
            <td class="num">
              <span class="t-caption dim">
                {m.pos_shift_expected()}
                {formatMoney(exp)} · {m.pos_shift_counted()}
                {formatMoney(cnt)}
              </span>
              <Badge variant="semantic" value={diff.balanced ? 'success' : 'warning'} size="sm">
                {m.pos_shift_difference()}: {diff.value == null ? '—' : formatMoney(diff.value)}
              </Badge>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
{/snippet}

{#snippet dayCell(dayKey: string)}
  {@const fold = dayFolds[dayKey]}
  {@const methodEntries = Object.entries(fold?.byMethod ?? {})}
  <div class="hb-day">
    <span class="hb-day-num t-caption dim">{Number(dayKey.slice(8, 10))}</span>
    {#if methodEntries.length === 0}
      <span class="hb-day-empty t-caption dim">{m.pos_history_day_empty()}</span>
    {:else}
      <span class="hb-day-total tabular-nums">{formatMoney(fold?.total ?? 0)}</span>
      {#each methodEntries.slice(0, MAX_DAY_METHODS) as [method, amount] (method)}
        <span class="hb-day-method t-caption dim tabular-nums">
          <span class="capitalize">{method}</span>
          {formatMoney(amount)}
        </span>
      {/each}
      {#if methodEntries.length > MAX_DAY_METHODS}
        <span class="hb-day-method t-caption dim">+{methodEntries.length - MAX_DAY_METHODS}</span>
      {/if}
    {/if}
  </div>
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
    <div class="hb-bar view-toolbar">
      <Input
        type="search"
        size="sm"
        bind:value={pageSearch}
        placeholder={m.data_table_search()}
        aria-label={m.data_table_search()}
        class="hb-search"
      >
        {#snippet leading()}<Search size={14} />{/snippet}
      </Input>
      <SegmentedControl
        items={viewItems}
        value={view}
        aria-label={m.pos_history_view_label()}
        onValueChange={setView}
      />
      {#if view !== 'list'}
        <div class="hb-nav">
          <Button variant="ghost" size="sm" aria-label={m.sched_prev()} onclick={() => step(-1)}>
            <ChevronLeft size={iconSizes.sm} />
          </Button>
          <Button variant="ghost" size="sm" onclick={goToday}>{m.common_today()}</Button>
          <Button variant="ghost" size="sm" aria-label={m.sched_next()} onclick={() => step(1)}>
            <ChevronRight size={iconSizes.sm} />
          </Button>
        </div>
      {/if}
    </div>

    {#if view === 'list'}
      {#if shiftSections.length === 0}
        <EmptyState title={m.pos_history_empty_tickets()} compact />
      {:else}
        <div class="shift-sections">
          {#each shiftSections as s (s.id)}
            {@const rows = ticketsByShift.get(s.id) ?? []}
            <section class="shift-section">
              {@render sectionHeader(s, rows)}
              {#if openShifts.has(s.id)}
                {@render summaryTable(s, rows)}
                <DataTable
                  class="shift-table"
                  columns={ticketColumns}
                  data={rows}
                  getRowId={(t) => t.id}
                  search={pageSearch}
                  searchFields={(t) =>
                    `${t.humanId ?? ''} ${t.customerName ?? ''} ${t.cashier ?? ''}`}
                  storageKey="pos-history-tickets"
                  chrome={false}
                  canEdit={false}
                  idColumn={{ value: (t) => t.humanId ?? t.id.slice(0, 8) }}
                  titleColumn={{ key: 'customer', href: (t) => `/pos/tickets/${t.id}` }}
                  emptyMessage={m.pos_history_empty_tickets()}
                  cells={{ date: dateCell, status: statusCell, methods: methodsCell }}
                  footer
                  initialAggregates={{ date: ['count'], total: ['sum'] }}
                  initialSort={{ key: 'date', dir: 'desc' }}
                />
              {/if}
            </section>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="hb-calendar hb-calendar-{view}">
        {#each calendarDayKeys as dayKey (dayKey)}
          {@render dayCell(dayKey)}
        {/each}
      </div>
    {/if}
  </PageBody>
</PageShell>

<style>
  .hb-search {
    width: 14rem;
  }
  .hb-nav {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .shift-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .shift-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .shift-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  :global(.shift-toggle) {
    transition: transform var(--duration-fast) var(--ease-standard);
  }
  :global(.shift-toggle.open) {
    transform: rotate(90deg);
    color: var(--color-accent);
  }
  .shift-title {
    display: inline-flex;
    align-items: center;
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
  .shift-summary {
    width: 100%;
    border-top: 1px solid var(--color-border);
    font-size: var(--font-size-label);
  }
  .shift-summary td {
    padding: var(--space-1) var(--space-3);
  }
  .shift-summary .num {
    text-align: right;
  }
  .shift-summary .total-row td {
    font-weight: var(--font-weight-medium);
  }
  .shift-summary .diff-row td {
    padding-top: var(--space-2);
  }
  .shift-summary .diff-row .num {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  :global(.shift-table) {
    border-top: 1px solid var(--color-border);
  }
  .hb-calendar {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .hb-day {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 4.5rem;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .hb-day-total {
    font-weight: var(--font-weight-medium);
  }
  .hb-day-method {
    display: block;
  }
</style>
