<script lang="ts">
  import type { PageData } from './$types';
  import { History, Search } from 'lucide-svelte';
  import { Calendar, DayGrid } from '@event-calendar/core';
  import '@event-calendar/core/index.css';
  import '$lib/components/scheduling/calendar/ec-skin.css';
  import { languageTag } from '$lib/paraglide/runtime';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, Input, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell, Sheet } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import { dayTotals, shiftsOnDay } from './payments-fold';
  import ShiftDetail from './ShiftDetail.svelte';
  import PaymentSummaryTable from './PaymentSummaryTable.svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';

  let { data }: { data: PageData } = $props();
  type Ticket = PageData['tickets'][number];
  type Shift = PageData['shifts'][number];
  type View = PageData['view'];

  // Page-level search: filters every shift's own ticket table (ShiftDetail's
  // `search` pass-through) — the parent shifts table has no search of its own.
  let pageSearch = $state('');

  // ── View + the calendar's current position. Mirrored in `?view=`/`?date=`
  // like /pos/appointments, but shallow: every payment the month view needs
  // is already in `data.payments` (same 500-row window as the ticket list),
  // so changing the month never needs a server round trip. ──
  // svelte-ignore state_referenced_locally
  let view = $state<View>(data.view);
  // svelte-ignore state_referenced_locally
  let calendarDate = $state(data.day);

  function syncUrl(nextView: View, nextDate: string) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('view', nextView);
    params.set('date', nextDate);
    replaceState(`${page.url.pathname}?${params}`, {});
  }
  function setView(next: View) {
    view = next;
    syncUrl(view, calendarDate);
  }

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }
  function fmtDay(key: string): string {
    const [y, mo, d] = key.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString(appLocale(), { dateStyle: 'long' });
  }

  // `total` is a Postgres numeric (string); same per-row Number() coercion the
  // DataTable's own money aggregate uses. Voided tickets don't count.
  const shiftTotal = (rows: Ticket[]) =>
    rows.reduce((sum, t) => (t.status === 'void' ? sum : sum + Number(t.total)), 0);

  // Tickets grouped by shift, in `data.shifts`' own order (newest-first).
  const ticketsByShift = $derived.by(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of data.tickets) map.set(t.shiftId, [...(map.get(t.shiftId) ?? []), t]);
    return map;
  });

  // Open-by-default: the shift still open, else the newest one (`data.shifts`
  // is newest-first already).
  const initialExpandedIds = (() => {
    const id = data.shifts.find((s) => !s.closedAt)?.id ?? data.shifts[0]?.id;
    return id ? [id] : [];
  })();

  const shiftColumns = $derived<DataColumn<Shift>[]>([
    { key: 'opened', label: m.pos_history_col_opened(), custom: true, accessor: (s) => s.openedAt },
    {
      key: 'closed',
      label: m.pos_history_col_closed(),
      custom: true,
      accessor: (s) => s.closedAt ?? '',
    },
    { key: 'cashier', label: m.pos_ticket_cashier(), accessor: (s) => s.openedByName ?? '—' },
    {
      key: 'tickets',
      label: m.pos_history_tab_tickets(),
      align: 'right',
      numeric: true,
      accessor: (s) => ticketsByShift.get(s.id)?.length ?? 0,
    },
    {
      key: 'total',
      label: m.pos_sell_total(),
      money: true,
      align: 'right',
      accessor: (s) => shiftTotal(ticketsByShift.get(s.id) ?? []),
    },
  ]);

  // ── Month calendar: one bold all-day event per day with its net total.
  // Per-method lines don't read cleanly in a 5.5rem month cell (ec-skin.css)
  // — the day Sheet below carries that detail instead. ──
  const dayFolds = $derived(dayTotals(data.payments, data.orgTz));
  const calendarEvents = $derived(
    Object.entries(dayFolds).map(([dayKey, fold]) => ({
      id: dayKey,
      start: dayKey,
      allDay: true,
      title: formatMoney(fold.total),
      classNames: ['ev-history-total'],
    })),
  );
  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  let calendar = $state<unknown>(null);
  // svelte-ignore state_referenced_locally -- seeds the calendar's initial
  // position once; later navigation moves via the calendar's own API, not
  // this reactive value.
  let options = $state<Record<string, unknown>>({
    date: calendarDate,
    view: 'dayGridMonth',
    locale: languageTag(),
    height: 'auto',
    dayMaxEvents: true,
    events: [],
    dateClick: (info: { dateStr: string }) => openDay(info.dateStr.slice(0, 10)),
    eventClick: (info: { event: { id: string | number } }) => openDay(String(info.event.id)),
    datesSet: (info: { view: { currentStart: Date } }) => {
      calendarDate = keyOf(info.view.currentStart);
      syncUrl(view, calendarDate);
    },
  });
  $effect(() => {
    options.events = calendarEvents;
  });
  $effect(() => {
    options.locale = languageTag();
  });

  // ── Day detail sheet ──
  let sheetOpen = $state(false);
  let selectedDayKey = $state<string | null>(null);
  function openDay(dayKey: string) {
    selectedDayKey = dayKey;
    sheetOpen = true;
  }
  const dayShifts = $derived.by(() => {
    if (!selectedDayKey) return [];
    const ids = shiftsOnDay(data.payments, data.orgTz, selectedDayKey);
    return data.shifts.filter((s) => ids.has(s.id));
  });
</script>

{#snippet openedCell(s: Shift)}
  <span class="tabular-nums">{fmtTime(s.openedAt)}</span>
{/snippet}
{#snippet closedCell(s: Shift)}
  {#if !s.closedAt}
    <Badge variant="semantic" value="info" size="sm">{m.pos_sell_shift_status_open()}</Badge>
  {:else}
    <span class="tabular-nums">{fmtTime(s.closedAt)}</span>
  {/if}
{/snippet}
{#snippet shiftExpanded(s: Shift)}
  <ShiftDetail
    shift={s}
    tickets={ticketsByShift.get(s.id) ?? []}
    methodTotals={data.methodTotals[s.id] ?? {}}
    search={pageSearch}
  />
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
    <DataView views={['table', 'calendar']} value={view} onchange={setView}>
      {#snippet children({ switcher, view: activeView })}
        <div class="hb-bar view-toolbar">
          <Input
            type="search"
            size="sm"
            bind:value={pageSearch}
            placeholder={m.data_table_search()}
            aria-label={m.data_table_search()}
            class="hb-search"
          >
            {#snippet leading()}<Search size={iconSizes.sm} />{/snippet}
          </Input>
          <span class="hb-switcher">{@render switcher()}</span>
        </div>

        {#if activeView === 'table'}
          <DataTable
            class="flex-1 min-h-0"
            variant="plain"
            columns={shiftColumns}
            data={data.shifts}
            getRowId={(s) => s.id}
            chrome={false}
            canEdit={false}
            emptyMessage={m.pos_history_empty_shifts()}
            cells={{ opened: openedCell, closed: closedCell }}
            expandedContent={shiftExpanded}
            isExpandable={(s) => ticketsByShift.has(s.id)}
            initialExpanded={initialExpandedIds}
          />
        {:else}
          <div class="hb-month">
            <Calendar bind:this={calendar} plugins={[DayGrid]} {options} />
          </div>
        {/if}
      {/snippet}
    </DataView>
  </PageBody>
</PageShell>

<Sheet
  bind:open={sheetOpen}
  title={selectedDayKey ? fmtDay(selectedDayKey) : ''}
  placement="right"
  size="lg"
>
  {#snippet children()}
    {#if selectedDayKey}
      {@const fold = dayFolds[selectedDayKey]}
      <div class="day-sheet">
        <PaymentSummaryTable total={fold?.total ?? 0} methodTotals={fold?.byMethod ?? {}} />
        {#if dayShifts.length === 0}
          <EmptyState title={m.pos_history_day_empty()} compact />
        {:else}
          {#each dayShifts as s (s.id)}
            <section class="day-shift">
              <h3 class="t-title">
                {fmtTime(s.openedAt)}{#if s.openedByName}<span class="dim">
                    · {s.openedByName}</span
                  >{/if}
              </h3>
              <ShiftDetail
                shift={s}
                tickets={ticketsByShift.get(s.id) ?? []}
                methodTotals={data.methodTotals[s.id] ?? {}}
              />
            </section>
          {/each}
        {/if}
      </div>
    {/if}
  {/snippet}
</Sheet>

<style>
  /* `class` reaches past `Input`'s own component boundary onto its root
     element — scoped under the toolbar so it stays a targeted override, not
     an unscoped global. */
  .hb-bar :global(.hb-search) {
    width: 14rem;
  }
  .hb-switcher {
    margin-left: auto;
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .hb-month {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2);
  }
  .hb-month :global(.ec-event.ev-history-total) {
    font-weight: var(--font-weight-medium);
  }
  .day-sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .day-shift {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
