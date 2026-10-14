<script lang="ts">
  /**
   * The daily dashboard (owner 2026-10-14: "improve the DAILY summary. its
   * unformatted and I'd like more of a DASHBOARD look and feel to it. Each user
   * can configure it manually …").
   *
   * Every section is a card on the record-detail recipe, and the viewer owns
   * which cards show and in what order — the same toggle + drag vocabulary the
   * calendar's field lists use (`FieldsList`), persisted per user through
   * `/api/me/preferences/dailyDashboard` so the layout follows them across
   * devices.
   *
   * TODO(handoff): the owner also asked to configure this "via agent builder
   * live, on the spot". That needs the builder to write a layout for another
   * user and a live channel to apply it, neither of which exists yet — the
   * preference section and the pure merge here are the seam it would write
   * through. Ledger: proposals/2026-10-14-hub-daily-dashboard.md.
   */
  import type { Snippet } from 'svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { CalendarDays, SlidersHorizontal } from 'lucide-svelte';
  import { PageHeader, Badge, Popover, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import FieldsList from '$lib/components/scheduling/FieldsList.svelte';
  import { syncPreferenceToServer } from '$lib/state/ui/preference-sync.svelte';
  import {
    DAILY_CARDS,
    mergeDailyLayout,
    moveCard,
    type DailyCard,
    type StoredDailyLayout,
  } from '$lib/inbox/daily-cards';

  let { data }: { data: PageData } = $props();
  const view = $derived(data.view);

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  }

  // ── Per-viewer card layout ───────────────────────────────────────────────
  const stored = $derived(
    (page.data as { preferences?: { preferences?: { dailyDashboard?: StoredDailyLayout } } })
      ?.preferences?.preferences?.dailyDashboard,
  );
  // svelte-ignore state_referenced_locally -- seeded once from the server bundle
  let layout = $state(mergeDailyLayout(stored));
  $effect(() => {
    layout = mergeDailyLayout(stored);
  });
  const shown = $derived(layout.order.filter((k) => !layout.hidden.has(k)));

  const cardLabel: Record<DailyCard, () => string> = {
    kpis: m.inbox_dailyKpis,
    appointments: m.inbox_dailyAppointments,
    unscheduled: m.inbox_dailyUnscheduled,
    unpaidVisits: m.inbox_dailyUnpaidVisits,
    openShifts: m.inbox_dailyOpenShifts,
  };
  const layoutFields = $derived(layout.order.map((k) => ({ key: k, label: cardLabel[k]() })));

  function persist() {
    syncPreferenceToServer('dailyDashboard', {
      hidden: [...layout.hidden],
      order: layout.order,
    });
  }
  function toggleCard(key: string) {
    const next = new Set(layout.hidden);
    if (next.has(key as DailyCard)) next.delete(key as DailyCard);
    else next.add(key as DailyCard);
    layout = { ...layout, hidden: next };
    persist();
  }
  function moveCardTo(from: string, to: string) {
    layout = { ...layout, order: moveCard(layout.order, from as DailyCard, to as DailyCard) };
    persist();
  }

  // ── Derived counts ───────────────────────────────────────────────────────
  const appointmentCount = $derived(
    view.appointmentsByStaff.reduce((n, s) => n + s.appointments.length, 0),
  );
  const pendingCount = $derived(
    view.pending.unscheduledPaidServices.length + view.pending.completedUnpaidVisits.length,
  );
  /** Masked finance roles get no amount at all, so the tile shows the count. */
  const salesAmount = $derived(
    data.maskMoney || !view.yesterdaySales.currency
      ? null
      : formatMoney(view.yesterdaySales.total, view.yesterdaySales.currency),
  );
  const allClear = $derived(pendingCount === 0 && view.pending.openShifts.length === 0);
</script>

{#snippet kpi(label: string, value: string, hint?: string)}
  <div class="kpi">
    <span class="t-caption kpi-label">{label}</span>
    <span class="kpi-value tabular-nums">{value}</span>
    {#if hint}<span class="t-caption kpi-hint">{hint}</span>{/if}
  </div>
{/snippet}

{#snippet card(title: string, count: number | null, body: Snippet)}
  <section class="card">
    <header class="card-h">
      <span>{title}</span>
      {#if count !== null && count > 0}
        <Badge variant="neutral" size="sm">{count}</Badge>
      {/if}
    </header>
    {@render body()}
  </section>
{/snippet}

{#snippet kpisCard()}
  <section class="card kpis">
    {@render kpi(
      m.inbox_dailySales(),
      salesAmount ?? String(view.yesterdaySales.count),
      salesAmount ? m.inbox_dailyTicketsKpi() + ` · ${view.yesterdaySales.count}` : undefined,
    )}
    {@render kpi(m.inbox_dailyAppointmentsKpi(), String(appointmentCount))}
    {@render kpi(m.inbox_dailyPendingKpi(), String(pendingCount))}
    {@render kpi(m.inbox_dailyOpenShifts(), String(view.pending.openShifts.length))}
    {#if !data.maskMoney && !view.yesterdaySales.currency && view.yesterdaySales.count > 0}
      <p class="t-caption mixed">{m.inbox_dailyMixedCurrency()}</p>
    {/if}
  </section>
{/snippet}

{#snippet appointmentsBody()}
  {#if view.appointmentsByStaff.length === 0}
    <p class="t-caption empty">{m.inbox_dailyNoAppointments()}</p>
  {:else}
    {#each view.appointmentsByStaff as staff (staff.staffId ?? staff.staffName)}
      <div class="staff">
        <span class="t-label staff-name">{staff.staffName}</span>
        <ul class="rows">
          {#each staff.appointments as appt (appt.id)}
            <li class="row">
              <span class="time tabular-nums">{fmtTime(appt.startTime)}</span>
              <span class="row-title">{appt.title ?? appt.status}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
{/snippet}

{#snippet unscheduledBody()}
  {#if view.pending.unscheduledPaidServices.length === 0}
    <p class="t-caption empty">{m.inbox_dailyNoUnscheduled()}</p>
  {:else}
    <ul class="rows">
      {#each view.pending.unscheduledPaidServices as line (line.lineId)}
        <li class="row">
          <a class="row-title" href="/pos/tickets/{line.ticketId}">{line.description}</a>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet unpaidBody()}
  {#if view.pending.completedUnpaidVisits.length === 0}
    <p class="t-caption empty">{m.inbox_dailyNoUnpaid()}</p>
  {:else}
    <ul class="rows">
      {#each view.pending.completedUnpaidVisits as visit (visit.bookingId)}
        <li class="row">
          <span class="time tabular-nums">{fmtTime(visit.endTime)}</span>
          <span class="row-title"
            >{visit.attendeeName ?? visit.title ?? m.inbox_dailyUnnamedVisit()}</span
          >
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet shiftsBody()}
  {#if view.pending.openShifts.length === 0}
    <p class="t-caption empty">{m.inbox_dailyNoOpenShifts()}</p>
  {:else}
    <ul class="rows">
      {#each view.pending.openShifts as shift (shift.shiftId)}
        <li class="row">
          <Badge variant="semantic" value="info" size="sm">{m.pos_sell_shift_status_open()}</Badge>
          <span class="row-title">{shift.openedByName ?? '—'}</span>
          <span class="t-caption time tabular-nums"
            >{m.inbox_dailySince({ time: fmtTime(shift.openedAt) })}</span
          >
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<PageShell archetype="collection" scroll="page" labelledBy="daily-feed-title">
  <PageHeader titleId="daily-feed-title" title={m.inbox_daily_title()} subtitle={view.date}>
    {#snippet leading()}<CalendarDays size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
    {#snippet actions()}
      <!-- One kebab owns per-viewer layout, like the calendar's. A Popover, not
         a Dropdown: it holds controls (toggle + drag), not menu items. -->
      <Popover placement="bottom-end">
        {#snippet trigger()}
          <span class="cfg-trigger">
            <SlidersHorizontal size={iconSizes.sm} />
            <span class="sr-only">{m.inbox_dailyLayout()}</span>
          </span>
        {/snippet}
        <div class="cfg-panel">
          <FieldsList
            heading={m.inbox_dailyLayout()}
            fields={layoutFields}
            hidden={layout.hidden}
            order={layout.order}
            ontoggle={toggleCard}
            onmove={moveCardTo}
          />
        </div>
      </Popover>
    {/snippet}
  </PageHeader>

  <PageBody width="content">
    {#if shown.length === 0}
      <p class="t-caption empty">{m.inbox_dailyNoData()}</p>
    {/if}
    <div class="grid">
      {#each shown as key (key)}
        {#if key === 'kpis'}
          {@render kpisCard()}
        {:else if key === 'appointments'}
          {@render card(m.inbox_dailyAppointments(), appointmentCount, appointmentsBody)}
        {:else if key === 'unscheduled'}
          {@render card(
            m.inbox_dailyUnscheduled(),
            view.pending.unscheduledPaidServices.length,
            unscheduledBody,
          )}
        {:else if key === 'unpaidVisits'}
          {@render card(
            m.inbox_dailyUnpaidVisits(),
            view.pending.completedUnpaidVisits.length,
            unpaidBody,
          )}
        {:else}
          {@render card(m.inbox_dailyOpenShifts(), view.pending.openShifts.length, shiftsBody)}
        {/if}
      {/each}
    </div>
    {#if allClear && shown.length > 0}
      <p class="t-caption empty">{m.inbox_dailyAllClear()}</p>
    {/if}
  </PageBody>
</PageShell>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  /* The KPI strip reads as one band, so it spans the whole row. */
  .kpis {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-4);
  }
  .card {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    align-content: start;
    min-width: 0;
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .kpi {
    display: grid;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .kpi-label,
  .kpi-hint {
    color: var(--color-text-secondary);
  }
  .kpi-value {
    font-size: var(--font-size-display);
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.1;
  }
  .mixed {
    grid-column: 1 / -1;
    color: var(--color-warning-fg);
  }
  .staff {
    display: grid;
    gap: var(--space-1);
  }
  .staff-name {
    color: var(--color-text-primary);
  }
  .rows {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .time {
    color: var(--color-text-tertiary);
    flex: none;
  }
  .row-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
  }
  .empty {
    color: var(--color-text-tertiary);
  }
  .cfg-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-xs);
    height: var(--control-height-xs);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .cfg-trigger:hover {
    background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
    color: var(--color-text-primary);
  }
  .cfg-panel {
    min-width: 14rem;
    padding: var(--space-2);
  }
</style>
