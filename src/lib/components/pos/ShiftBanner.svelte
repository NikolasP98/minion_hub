<script lang="ts">
  import { Button } from '$lib/components/ui';
  import DataSource from '$lib/components/ui/DataSource.svelte';

  import { page } from '$app/state';
  import {
    AlertTriangle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Users,
  } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { EmptyState, Popover, Spinner, Tooltip, iconSizes } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import PeekLink from '$lib/records/PeekLink.svelte';
  import { getShiftDialogs } from './shift-dialogs-context';
  import { appLocale, formatMoney, formatTime } from '$lib/utils/format';
  import {
    incomeTotal,
    methodIncome,
    paymentsOfMethod,
    type ShiftPaymentRow,
  } from './shift-income';

  const STALE_MS = 16 * 60 * 60 * 1000;

  // ponytail: recomputed on a slow tick rather than a live per-second clock — the
  // stale threshold is measured in hours, a minute of drift is invisible to a cashier.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  // Dialogs live in `ShiftDialogs` (mounted once by the POS layout); without it
  // (stories, tests) the buttons would do nothing, so they are not rendered.
  const dialogs = getShiftDialogs();

  const settings = $derived(
    page.data.posSettings as { methods: PosMethodLike[]; shiftMode?: 'manual' | 'auto' },
  );
  // Spec 148 "Caja automática": the first sale opens the shift and a midnight
  // job closes it, so there is nothing to open and no stale shift to warn about.
  const auto = $derived(settings?.shiftMode === 'auto');
  const openShift = $derived(
    page.data.openShift as { shift: PosShiftLike; summary: ShiftSummaryLike } | null,
  );
  const openerName = $derived((page.data.openerName as string | null) ?? null);
  // Shifts are per user: these are the OTHER members' open registers (the
  // loader already excludes the caller's own and resolves the names).
  const otherShifts = $derived(
    (page.data.openShifts as OtherShiftLike[] | undefined) ?? ([] as OtherShiftLike[]),
  );

  // The banner renders its rail twice (wide box ≥xl, compact rail <xl) and a
  // Popover's panel floats outside its hidden trigger, so a shared boolean
  // showed both panels (same trap as the income menu). ONE key here: the open
  // instance is the one whose key matches.
  let othersOpen = $state<string | null>(null);

  // Narrow local shapes (mirrors server types) — avoids importing $server/* runtime
  // modules into a client component.
  interface PosShiftLike {
    id: string;
    openedAt: string | Date;
    openingFloat: Record<string, number>;
  }
  interface ShiftSummaryLike {
    ticketCount: number;
    voidCount: number;
    gross: number;
    byMethod: Record<string, number>;
    /** Tickets the close will hand to SUNAT (spec 2026-10-15 T2). */
    unemitted?: number;
  }
  interface OtherShiftLike {
    id: string;
    openedAt: string | Date;
    openedByName: string | null;
  }
  interface PosMethodLike {
    id: string;
    label: string;
    enabled: boolean;
    takesTendered: boolean;
  }

  const isStale = $derived(
    openShift && !auto ? now - new Date(openShift.shift.openedAt).getTime() > STALE_MS : false,
  );
  const openedAtLabel = $derived(
    openShift ? new Date(openShift.shift.openedAt).toLocaleString(appLocale()) : '',
  );

  // ── Income menu (owner ask 2026-10-10) ────────────────────────────────────
  // The per-method pills became ONE trigger opening a two-level menu: methods
  // with their shift totals, then that method's tickets. One Popover with a
  // `page` state (the calendar kebab's pattern) — no nested floating panel to
  // lose on a stray click. Level 1 is already in `summary.byMethod`; only the
  // ticket rows are fetched, and only while the menu is open.
  // The banner renders the income menu twice (wide box ≥xl, compact rail <xl;
  // only one is ever displayed) but a Popover's panel floats outside its
  // hidden trigger, so sharing ONE open flag showed both panels. Each
  // instance owns its flag; the menu logic reads the union.
  let incomeOpenWide = $state(false);
  let incomeOpenMini = $state(false);
  const incomeOpen = $derived(incomeOpenWide || incomeOpenMini);
  function closeIncome() {
    incomeOpenWide = false;
    incomeOpenMini = false;
  }
  let incomeMethod = $state<string | null>(null);
  let payments = $state<ShiftPaymentRow[]>([]);
  let paymentsLoaded = $state(false);
  let paymentsError = $state(false);

  const methodRows = $derived(
    openShift ? methodIncome(openShift.summary.byMethod, settings.methods) : [],
  );
  const incomeSum = $derived(openShift ? incomeTotal(openShift.summary.byMethod) : 0);
  const methodLabel = $derived(methodRows.find((row) => row.id === incomeMethod)?.label ?? '');
  const methodPayments = $derived(incomeMethod ? paymentsOfMethod(payments, incomeMethod) : []);

  $effect(() => {
    if (!incomeOpen) {
      incomeMethod = null;
      return;
    }
    void loadPayments();
  });

  // Stale-while-revalidate: the rows already on screen stay there during a
  // refetch, so only the FIRST open can render an empty state.
  async function loadPayments() {
    paymentsError = false;
    try {
      const res = await fetch('/api/pos/shifts/current?payments=1');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { payments?: ShiftPaymentRow[] };
      payments = data.payments ?? [];
      paymentsLoaded = true;
    } catch {
      paymentsError = true;
    }
  }
</script>

<!-- "Shift open" is an ICON with a tooltip, not a text label (owner ask
     2026-10-10) — and when the shift is stale the same indicator carries the
     stale message, so neither needs its own line of the banner. -->
{#snippet indicator()}
  <Tooltip
    label={isStale ? m.pos_shift_stale() : m.pos_sell_shift_status_open()}
    placement="bottom"
  >
    {#if isStale}
      <Clock size={iconSizes.sm} class="stale-ind" role="img" aria-label={m.pos_shift_stale()} />
    {:else}
      <span class="dot" role="img" aria-label={m.pos_sell_shift_status_open()}></span>
    {/if}
  </Tooltip>
{/snippet}

<!-- Colleagues' open registers (owner ask 2026-10-10): icon + count with a
     tooltip, listing name · since. Absent when nobody else is open. -->
{#snippet colleagues(key: string)}
  {#if otherShifts.length}
    <span class="others">
      <Popover
        bind:open={() => othersOpen === key, (v) => (othersOpen = v ? key : null)}
        placement="bottom"
      >
        {#snippet trigger()}
          <Tooltip
            label={m.pos_shift_others_open({ count: otherShifts.length })}
            placement="bottom"
          >
            <span class="others-trigger">
              <!-- The icon carries the button's accessible name (same pattern as
                   the shift-open indicator above) — the count alone said nothing. -->
              <Users
                size={iconSizes.sm}
                role="img"
                aria-label={m.pos_shift_others_open({ count: otherShifts.length })}
              />
              <span class="others-count">{otherShifts.length}</span>
            </span>
          </Tooltip>
        {/snippet}
        <div class="others-panel">
          <p class="others-title">{m.pos_shift_others_open({ count: otherShifts.length })}</p>
          {#each otherShifts as other (other.id)}
            <span class="others-row">
              <span class="others-name">{other.openedByName ?? '—'}</span>
              <span class="others-since"
                >{m.pos_shift_other_since({ time: formatTime(other.openedAt) })}</span
              >
            </span>
          {/each}
        </div>
      </Popover>
    </span>
  {/if}
{/snippet}

{#snippet income(wide: boolean)}
  <span class="income">
    <Popover
      bind:open={
        () => (wide ? incomeOpenWide : incomeOpenMini),
        (v) => (wide ? (incomeOpenWide = v) : (incomeOpenMini = v))
      }
      placement="bottom"
    >
      {#snippet trigger()}
        <span class="inc-trigger">
          <span>{m.pos_shift_income({ amount: formatMoney(incomeSum) })}</span>
          <ChevronDown size={iconSizes.xs} />
        </span>
      {/snippet}
      <div class="inc-panel">
        {#if incomeMethod === null}
          {#if methodRows.length === 0}
            <EmptyState title={m.pos_shift_income_empty()} compact />
          {:else}
            {#each methodRows as row (row.id)}
              <Button
                variant="ghost"
                size="sm"
                class="inc-row"
                onclick={() => (incomeMethod = row.id)}
              >
                <span class="inc-row-label">{row.label}</span>
                <span class="inc-row-value">{formatMoney(row.total)}</span>
                <ChevronRight size={iconSizes.sm} />
              </Button>
            {/each}
          {/if}
        {:else}
          <Button variant="ghost" size="sm" class="inc-back" onclick={() => (incomeMethod = null)}>
            <ChevronLeft size={iconSizes.sm} />
            <span class="sr-only">{m.common_back()}</span>
            <span class="inc-back-title">{methodLabel}</span>
          </Button>
          {#if paymentsError}
            <span class="inc-msg" role="alert">{m.picker_load_failed()}</span>
          {:else if !paymentsLoaded}
            <span class="inc-msg"><Spinner size="xs" /></span>
          {:else if methodPayments.length === 0}
            <EmptyState title={m.common_noMatches()} compact />
          {:else}
            <!-- The ticket record page is the existing invoice detail surface
                 and is registered as peekable, so a row opens it in the
                 record modal (owner ask) rather than navigating away. -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="inc-list" onclickcapture={closeIncome}>
              {#each methodPayments as pay (pay.id)}
                <PeekLink class="inc-ticket" href={`/pos/tickets/${pay.ticketId}`} mode="modal">
                  <span class="inc-tid">{pay.humanId ?? '—'}</span>
                  <span class="inc-cust">{pay.customerName ?? '—'}</span>
                  <span class="inc-amt">{formatMoney(pay.amount)}</span>
                  <span class="inc-time">{formatTime(pay.paidAt)}</span>
                </PeekLink>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </Popover>
  </span>
{/snippet}

<DataSource value={page.data.posSettings} module="pos" compact>
  {#if !openShift}
    <!-- Sidebar footer widget: full card ≥xl, icon-only button on the collapsed rail. -->
    <div class="box box-open hidden xl:flex">
      <div class="status">
        {#if auto}
          <span class="msg">{m.pos_shift_auto_waiting()}</span>
        {:else}
          <AlertTriangle size={iconSizes.sm} class="shrink-0" />
          <span class="msg">{m.pos_no_open_shift()}</span>
        {/if}
      </div>
      <!-- central apiWriteCapability maps POS writes to pos:edit — gate must match -->
      {#if dialogs && !auto && canAct('pos', 'edit')}
        <Button type="button" class="act" onclick={dialogs.startOpen}
          >{m.pos_shift_open_cta()}</Button
        >
      {/if}
      {@render colleagues('closed-wide')}
    </div>
    <div class="mini-rail">
      <div class="mini-row mini-open-row">
        {#if auto}
          <span class="mini-status">{m.pos_shift_auto_waiting()}</span>
        {:else}
          <AlertTriangle size={iconSizes.sm} class="shrink-0" />
          <span class="mini-status">{m.pos_no_open_shift()}</span>
        {/if}
        {@render colleagues('closed-mini')}
        {#if dialogs && !auto && canAct('pos', 'edit')}
          <Button type="button" class="act" onclick={dialogs.startOpen}
            >{m.pos_shift_open_cta()}</Button
          >
        {/if}
      </div>
    </div>
  {:else}
    <div class="box box-live hidden xl:flex">
      <div class="status">
        {@render indicator()}
        <span class="tickets">{openShift.summary.ticketCount}</span>
      </div>
      <span class="since"
        >{auto
          ? m.pos_shift_auto_today()
          : m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span
      >
      {@render income(true)}
      {@render colleagues('live-wide')}
      <!-- Closing your OWN register is a pos:edit operation (what opens it);
         `pos: manage` only gates closing someone else's (API, close route). -->
      {#if dialogs && canAct('pos', 'edit')}
        <Button type="button" class="act" onclick={dialogs.startClose}
          >{m.pos_shift_close_cta()}</Button
        >
      {/if}
    </div>
    <div class="mini-rail">
      <div class="mini-row">
        {@render indicator()}
        <span class="tickets">{openShift.summary.ticketCount}</span>
        <span class="mini-detail"
          >{auto
            ? m.pos_shift_auto_today()
            : m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span
        >
        {@render income(false)}
        {@render colleagues('live-mini')}
        {#if dialogs && canAct('pos', 'edit')}
          <Button type="button" class="act" onclick={dialogs.startClose}
            >{m.pos_shift_close_cta()}</Button
          >
        {/if}
      </div>
    </div>
  {/if}
</DataSource>

<style>
  /* ── Sidebar footer widget ── */
  .box {
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    font-size: var(--font-size-caption);
  }
  .box-open {
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
    color: var(--color-warning);
  }
  .box-live {
    color: var(--color-muted-foreground);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    font-weight: 600;
  }
  .box :global(.act) {
    /* The CTA keeps its own width under the message (never stretched, never
       wider than the 208px column) — a stretched shared Button centres its
       inner row and clipped "Open shift" against the column edge. */
    align-self: flex-start;
    max-width: 100%;
    white-space: nowrap;
  }
  .box-live .status {
    color: var(--color-foreground);
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-success);
    flex-shrink: 0;
  }
  .box-live :global(.stale-ind),
  .mini-row :global(.stale-ind) {
    color: var(--color-brand);
    flex-shrink: 0;
  }
  .tickets {
    color: var(--color-accent);
    font-variant-numeric: tabular-nums;
  }
  .since {
    font-size: var(--font-size-caption);
    line-height: 1.35;
    color: var(--color-muted-foreground);
  }
  /* ── Colleagues' open registers ── */
  .others {
    flex-shrink: 0;
  }
  .others-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .others-trigger:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .others-count {
    font-variant-numeric: tabular-nums;
  }
  .others-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 13rem;
    max-width: min(22rem, calc(100vw - 2 * var(--space-4)));
  }
  .others-title {
    margin: 0;
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted-foreground);
  }
  .others-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-primary);
  }
  .others-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .others-since {
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  /* ── Income menu: one trigger, two levels ── */
  .income {
    flex-shrink: 0;
    min-width: 0;
  }
  .inc-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .inc-trigger:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .inc-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 15rem;
    max-width: min(24rem, calc(100vw - 2 * var(--space-4)));
  }
  /* Forwarded-class contract: these land on shared `Button`s, so they need
     :global under the scoped panel, and the Button's inner row <span> needs
     its own rule to lay the three cells out. */
  .inc-panel :global(.inc-row),
  .inc-panel :global(.inc-back) {
    width: 100%;
    justify-content: flex-start;
  }
  .inc-panel :global(.inc-row > span),
  .inc-panel :global(.inc-back > span) {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-2);
  }
  .inc-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .inc-row-value {
    font-variant-numeric: tabular-nums;
  }
  .inc-back-title {
    font-weight: 600;
  }
  .inc-msg {
    display: flex;
    justify-content: center;
    padding: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  :global(.inc-ticket) {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) max-content;
    align-items: baseline;
    gap: var(--space-0-5) var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    text-decoration: none;
  }
  :global(.inc-ticket:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .inc-tid {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .inc-cust,
  .inc-time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .inc-amt {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: right;
  }
  .inc-time {
    grid-column: 2 / -1;
    text-align: right;
  }
  .box :global(.act),
  .mini-row :global(.act) {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md, 6px);
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font-size: var(--font-size-caption);
    cursor: pointer;
  }
  .mini-row :global(.act):hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .box-live :global(.act) {
    color: var(--color-muted-foreground);
  }
  /* Compact strip (< xl): here the SectionNav footer is a FULL-WIDTH horizontal
     bar (not a narrow icon rail), so show status + detail + action inline rather
     than a bare dot. Display is controlled on the scoped .mini-rail wrapper. */
  .mini-rail {
    display: none;
  }
  @media (max-width: 1279.98px) {
    .mini-rail {
      display: block;
    }
  }
  /* Since the console-style POS menu (PR 338) this footer is a NARROW column at
     every width, not a full-width bar: the row must wrap (button drops under
     the message, right-aligned) and the message must be allowed to shrink —
     otherwise the CTA overlapped or clipped ("pen shift") on first paint. */
  .mini-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .mini-row .mini-status {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    color: var(--color-foreground);
  }
  .mini-open-row {
    color: var(--color-warning);
  }
  .mini-open-row .mini-status {
    color: var(--color-warning);
  }
  .mini-detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mini-row :global(.act) {
    margin-left: auto;
    flex-shrink: 0;
  }
  .box :global(.act.primary) {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    color: var(--color-accent);
  }
  .box :global(.act):hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
</style>
