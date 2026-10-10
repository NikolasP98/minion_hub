<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { EmptyState, Modal, Popover, Spinner, Tooltip, iconSizes } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import PeekLink from '$lib/records/PeekLink.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import { formatMoney, formatTime } from '$lib/utils/format';
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

  const settings = $derived(page.data.posSettings as { methods: PosMethodLike[] });
  const openShift = $derived(
    page.data.openShift as { shift: PosShiftLike; summary: ShiftSummaryLike } | null,
  );
  const openerName = $derived((page.data.openerName as string | null) ?? null);

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
  }
  interface PosMethodLike {
    id: string;
    label: string;
    enabled: boolean;
    takesTendered: boolean;
  }

  // Only enabled methods get an opening-float / counted input at shift
  // open/close — a disabled method has nothing to reconcile.
  const enabledMethods = $derived(settings.methods.filter((mth) => mth.enabled));
  // Only a cash-style tender is physically in the drawer: it takes an opening
  // float and a count at close. Wallets, cards and transfers are recorded by
  // the register as they happen — their "counted" IS the expected total.
  const countedMethods = $derived(enabledMethods.filter((mth) => mth.takesTendered));
  const recordedMethods = $derived(enabledMethods.filter((mth) => !mth.takesTendered));

  const isStale = $derived(
    openShift ? now - new Date(openShift.shift.openedAt).getTime() > STALE_MS : false,
  );
  const openedAtLabel = $derived(
    openShift ? new Date(openShift.shift.openedAt).toLocaleString() : '',
  );

  function zeroedByMethod(): Record<string, number> {
    return Object.fromEntries(enabledMethods.map((mth) => [mth.id, 0]));
  }

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

  // ---- open shift ----
  let openModal = $state(false);
  let openingFloat = $state<Record<string, number>>({});

  function startOpen() {
    openingFloat = zeroedByMethod();
    openModal = true;
  }

  async function submitOpen() {
    await toastAsync(
      (async () => {
        const res = await fetch('/api/pos/shifts/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openingFloat }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Failed to open shift (${res.status})`);
        }
        openModal = false;
        await invalidate('pos:shift');
      })(),
      {
        loading: `${m.pos_shift_open_cta()}…`,
        getOutcome: () => ({ type: 'success', title: m.pos_shift_open_cta() }),
        // A 409 (shift_already_open) means another tab beat us — resync so the
        // banner doesn't stay stuck on the stale "no shift" state.
        onError: (err: unknown) => {
          invalidate('pos:shift');
          return {
            title: m.pos_shift_open_cta(),
            description: err instanceof Error ? err.message : String(err),
          };
        },
      },
    );
  }

  // ---- close shift ----
  let closeModal = $state(false);
  let counted = $state<Record<string, number>>({});
  let note = $state('');
  let expected = $state<Record<string, number>>({});

  async function startClose() {
    counted = zeroedByMethod();
    note = '';
    closeModal = true;
    // Fresh read so the expected totals reflect any sale that landed after the
    // page's own load (another register tab, a delayed POST, etc).
    const res = await fetch('/api/pos/shifts/current');
    const data = (await res.json().catch(() => ({}))) as {
      shift?: PosShiftLike;
      summary?: ShiftSummaryLike;
    };
    if (!data.shift || !data.summary) {
      // Shift already closed elsewhere between opening this menu and now.
      closeModal = false;
      await invalidate('pos:shift');
      return;
    }
    const byMethod = data.summary.byMethod ?? {};
    const float = data.shift.openingFloat ?? {};
    expected = { ...byMethod };
    for (const mth of settings.methods) {
      if (!mth.takesTendered) continue;
      expected[mth.id] = (expected[mth.id] ?? 0) + Number(float[mth.id] ?? 0);
    }
  }

  function difference(mth: string): number {
    return Math.round(((counted[mth] ?? 0) - (expected[mth] ?? 0)) * 100) / 100;
  }

  async function submitClose() {
    await toastAsync(
      (async () => {
        const res = await fetch('/api/pos/shifts/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            counted: {
              ...counted,
              ...Object.fromEntries(recordedMethods.map((mth) => [mth.id, expected[mth.id] ?? 0])),
            },
            note: note || null,
          }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Failed to close shift (${res.status})`);
        }
        closeModal = false;
        await invalidate('pos:shift');
      })(),
      {
        loading: `${m.pos_shift_close_cta()}…`,
        getOutcome: () => ({ type: 'success', title: m.pos_shift_close_cta() }),
        // A 409 here typically means another tab already closed (or re-opened) the
        // shift — surface the server's message and resync local state either way.
        onError: (err: unknown) => {
          invalidate('pos:shift');
          return {
            title: m.pos_shift_close_cta(),
            description: err instanceof Error ? err.message : String(err),
          };
        },
      },
    );
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

{#if !openShift}
  <!-- Sidebar footer widget: full card ≥xl, icon-only button on the collapsed rail. -->
  <div class="box box-open hidden xl:flex">
    <div class="status">
      <AlertTriangle size={13} class="shrink-0" />
      <span class="msg">{m.pos_no_open_shift()}</span>
    </div>
    <!-- central apiWriteCapability maps POS writes to pos:edit — gate must match -->
    {#if canAct('pos', 'edit')}
      <Button type="button" class="act" onclick={startOpen}>{m.pos_shift_open_cta()}</Button>
    {/if}
  </div>
  <div class="mini-rail">
    <div class="mini-row mini-open-row">
      <AlertTriangle size={14} class="shrink-0" />
      <span class="mini-status">{m.pos_no_open_shift()}</span>
      {#if canAct('pos', 'edit')}
        <Button type="button" class="act" onclick={startOpen}>{m.pos_shift_open_cta()}</Button>
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
      >{m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span
    >
    {@render income(true)}
    {#if canAct('pos', 'manage')}
      <Button type="button" class="act" onclick={startClose}>{m.pos_shift_close_cta()}</Button>
    {/if}
  </div>
  <div class="mini-rail">
    <div class="mini-row">
      {@render indicator()}
      <span class="tickets">{openShift.summary.ticketCount}</span>
      <span class="mini-detail"
        >{m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span
      >
      {@render income(false)}
      {#if canAct('pos', 'manage')}
        <Button type="button" class="act" onclick={startClose}>{m.pos_shift_close_cta()}</Button>
      {/if}
    </div>
  </div>
{/if}

<Modal bind:open={openModal} title={m.pos_shift_open_cta()} size="sm">
  <div class="form">
    {#each countedMethods as mth (mth.id)}
      <label class="field">
        <span class="lbl">{m.pos_shift_float()} · {mth.label}</span>
        <input type="number" step="0.01" bind:value={openingFloat[mth.id]} />
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button type="button" class="act primary" onclick={submitOpen}>{m.pos_shift_open_cta()}</Button>
  {/snippet}
</Modal>

<Modal bind:open={closeModal} title={m.pos_shift_close_cta()} size="lg">
  <div class="form">
    {#each countedMethods as mth (mth.id)}
      <div class="close-row">
        <span class="method">{mth.label}</span>
        <span class="cell">
          <span class="lbl">{m.pos_shift_expected()}</span>
          <span class="num expected">{formatMoney(expected[mth.id] ?? 0)}</span>
        </span>
        <label class="field cell">
          <span class="lbl">{m.pos_shift_counted()}</span>
          <input type="number" step="0.01" bind:value={counted[mth.id]} />
        </label>
        <span class="cell">
          <span class="lbl">{m.pos_shift_difference()}</span>
          <span
            class="num diff"
            class:neg={difference(mth.id) < 0}
            class:pos={difference(mth.id) > 0}
          >
            {formatMoney(difference(mth.id))}
          </span>
        </span>
      </div>
    {/each}
    {#if recordedMethods.length}
      <p class="lbl recorded-title">{m.pos_shift_auto_recorded()}</p>
      <div class="recorded">
        {#each recordedMethods as mth (mth.id)}
          <span class="recorded-row">
            <span>{mth.label}</span>
            <span class="num">{formatMoney(expected[mth.id] ?? 0)}</span>
          </span>
        {/each}
      </div>
    {/if}
    <label class="field">
      <span class="lbl">{m.pos_shift_note()}</span>
      <textarea bind:value={note} rows="2"></textarea>
    </label>
  </div>
  {#snippet footer()}
    <Button type="button" class="act primary" onclick={submitClose}
      >{m.pos_shift_close_cta()}</Button
    >
  {/snippet}
</Modal>

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

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lbl {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted-foreground);
  }
  input[type='number'],
  textarea {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md, 6px);
    border: 1px solid var(--color-border);
    background: var(--color-canvas);
    color: var(--color-foreground);
    font-size: var(--font-size-body);
  }
  .recorded-title {
    margin: var(--space-2) 0 0;
  }
  .recorded {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1) var(--space-3);
  }
  .recorded-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .recorded-row .num {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  /* Method · expected · counted · difference as four aligned columns, each
     value under its own caption; on a phone the method name takes its own
     line and the three figures share the next one — nothing overlaps. */
  .close-row {
    display: grid;
    grid-template-columns: minmax(7rem, 1.2fr) repeat(3, minmax(6.5rem, 1fr));
    align-items: end;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .method {
    font-size: var(--font-size-body);
    font-weight: 500;
    min-width: 0;
    overflow-wrap: anywhere;
    align-self: center;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    line-height: var(--control-height-sm);
  }
  .expected {
    color: var(--color-text-secondary);
  }
  .close-row .field input {
    width: 100%;
    min-width: 0;
    height: var(--control-height-sm);
  }
  @media (max-width: 560px) {
    .close-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .method {
      grid-column: 1 / -1;
    }
  }
  .diff.neg {
    color: var(--color-brand);
  }
  .diff.pos {
    color: var(--color-success);
  }
</style>
