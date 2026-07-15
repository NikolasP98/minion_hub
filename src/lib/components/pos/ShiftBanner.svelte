<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { AlertTriangle, Clock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';

  const STALE_MS = 16 * 60 * 60 * 1000;

  // ponytail: recomputed on a slow tick rather than a live per-second clock — the
  // stale threshold is measured in hours, a minute of drift is invisible to a cashier.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  const settings = $derived(page.data.posSettings as { methods: string[] });
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

  const isStale = $derived(
    openShift ? now - new Date(openShift.shift.openedAt).getTime() > STALE_MS : false,
  );
  const openedAtLabel = $derived(
    openShift ? new Date(openShift.shift.openedAt).toLocaleString() : '',
  );

  function zeroedByMethod(): Record<string, number> {
    return Object.fromEntries(settings.methods.map((mth) => [mth, 0]));
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
    expected.cash = (expected.cash ?? 0) + Number(float.cash ?? 0);
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
          body: JSON.stringify({ counted, note: note || null }),
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
    <Button
      type="button"
      class="mini mini-open"
      title={m.pos_shift_open_cta()}
      disabled={!canAct('pos', 'edit')}
      onclick={startOpen}
    >
      <AlertTriangle size={16} />
    </Button>
  </div>
{:else}
  <div class="box box-live hidden xl:flex">
    <div class="status">
      <span class="dot" class:stale-dot={isStale}></span>
      <span class="msg">{m.pos_sell_shift_status_open()}</span>
      <span class="tickets">{openShift.summary.ticketCount}</span>
    </div>
    <span class="since"
      >{m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span
    >
    <div class="totals">
      {#each Object.entries(openShift.summary.byMethod) as [mth, amt] (mth)}
        <span class="pill">{mth}: {formatMoney(amt)}</span>
      {/each}
    </div>
    {#if isStale}
      <span class="stale"><Clock size={12} class="shrink-0" />{m.pos_shift_stale()}</span>
    {/if}
    {#if canAct('pos', 'manage')}
      <Button type="button" class="act" onclick={startClose}>{m.pos_shift_close_cta()}</Button>
    {/if}
  </div>
  <div class="mini-rail">
    <Button
      type="button"
      class="mini"
      title={isStale
        ? m.pos_shift_stale()
        : m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}
      disabled={!canAct('pos', 'manage')}
      onclick={startClose}
    >
      <span class="dot" class:stale-dot={isStale}></span>
    </Button>
  </div>
{/if}

<Modal bind:open={openModal} title={m.pos_shift_open_cta()} size="sm">
  <div class="form">
    {#each settings.methods as mth (mth)}
      <label class="field">
        <span class="lbl">{m.pos_shift_float()} · {mth}</span>
        <input type="number" step="0.01" bind:value={openingFloat[mth]} />
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button type="button" class="act primary" onclick={submitOpen}>{m.pos_shift_open_cta()}</Button>
  {/snippet}
</Modal>

<Modal bind:open={closeModal} title={m.pos_shift_close_cta()} size="sm">
  <div class="form">
    {#each settings.methods as mth (mth)}
      <div class="close-row">
        <span class="lbl">{mth}</span>
        <span class="expected">{m.pos_shift_expected()}: {formatMoney(expected[mth] ?? 0)}</span>
        <label class="field">
          <span class="lbl">{m.pos_shift_counted()}</span>
          <input type="number" step="0.01" bind:value={counted[mth]} />
        </label>
        <span class="diff" class:neg={difference(mth) < 0} class:pos={difference(mth) > 0}>
          {m.pos_shift_difference()}: {formatMoney(difference(mth))}
        </span>
      </div>
    {/each}
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
    font-weight: 600;
  }
  .box-live .status {
    color: var(--color-foreground);
  }
  .msg {
    flex: 1;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-success);
    flex-shrink: 0;
  }
  .dot.stale-dot {
    background: var(--color-brand);
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
  .totals {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .pill {
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-caption);
  }
  .stale {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-brand) 15%, transparent);
    color: var(--color-brand);
    font-size: var(--font-size-caption);
  }
  .box :global(.act) {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md, 6px);
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font-size: var(--font-size-caption);
    cursor: pointer;
  }
  .box-live :global(.act) {
    color: var(--color-muted-foreground);
  }
  /* Collapsed rail (< xl) only: a single icon button carrying the status color.
     Display is controlled on the scoped .mini-rail wrapper — the Button is a
     component child, so scoped rules need a real ancestor anchor (a bare
     `.box :global(.mini)` never matched: .mini is a SIBLING of .box). */
  .mini-rail {
    display: none;
  }
  @media (max-width: 1279.98px) {
    .mini-rail {
      display: block;
    }
  }
  .mini-rail :global(.mini) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: var(--space-2) 0;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-muted-foreground);
  }
  .mini-rail :global(.mini-open) {
    color: var(--color-warning);
  }
  .mini-rail :global(.mini):disabled {
    cursor: default;
    opacity: 0.7;
  }
  .mini-rail :global(.mini):not(:disabled):hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
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
  .close-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .close-row .lbl {
    width: 70px;
    flex-shrink: 0;
  }
  .expected {
    width: 110px;
    flex-shrink: 0;
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .close-row .field {
    flex: 1;
  }
  .diff {
    width: 110px;
    flex-shrink: 0;
    text-align: right;
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
  }
  .diff.neg {
    color: var(--color-brand);
  }
  .diff.pos {
    color: var(--color-success);
  }
</style>
