<script lang="ts">
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { AlertTriangle, Clock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';

  const STALE_MS = 16 * 60 * 60 * 1000;

  // ponytail: recomputed on a slow tick rather than a live per-second clock — the
  // stale threshold is measured in hours, a minute of drift is invisible to a cashier.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  const settings = $derived(page.data.posSettings as { methods: string[] });
  const openShift = $derived(page.data.openShift as { shift: PosShiftLike; summary: ShiftSummaryLike } | null);
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
    const data = (await res.json().catch(() => ({}))) as { shift?: PosShiftLike; summary?: ShiftSummaryLike };
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
  <div class="strip strip-open">
    <AlertTriangle size={15} class="ic" />
    <span class="msg">{m.pos_shift_open_cta()}</span>
    <!-- central apiWriteCapability maps POS writes to pos:edit — gate must match -->
    {#if canAct('pos', 'edit')}
      <button type="button" class="act" onclick={startOpen}>{m.pos_shift_open_cta()}</button>
    {/if}
  </div>
{:else}
  <div class="strip strip-live">
    <span class="since">{m.pos_shift_open_since({ time: openedAtLabel, name: openerName ?? '—' })}</span>
    <div class="totals">
      {#each Object.entries(openShift.summary.byMethod) as [mth, amt] (mth)}
        <span class="pill">{mth}: {amt.toFixed(2)}</span>
      {/each}
      <span class="pill tickets">{openShift.summary.ticketCount}</span>
    </div>
    {#if isStale}
      <span class="stale"><Clock size={13} class="ic" />{m.pos_shift_stale()}</span>
    {/if}
    {#if canAct('pos', 'manage')}
      <button type="button" class="act" onclick={startClose}>{m.pos_shift_close_cta()}</button>
    {/if}
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
    <button type="button" class="act primary" onclick={submitOpen}>{m.pos_shift_open_cta()}</button>
  {/snippet}
</Modal>

<Modal bind:open={closeModal} title={m.pos_shift_close_cta()} size="sm">
  <div class="form">
    {#each settings.methods as mth (mth)}
      <div class="close-row">
        <span class="lbl">{mth}</span>
        <span class="expected">{m.pos_shift_expected()}: {(expected[mth] ?? 0).toFixed(2)}</span>
        <label class="field">
          <span class="lbl">{m.pos_shift_counted()}</span>
          <input type="number" step="0.01" bind:value={counted[mth]} />
        </label>
        <span class="diff" class:neg={difference(mth) < 0} class:pos={difference(mth) > 0}>
          {m.pos_shift_difference()}: {difference(mth).toFixed(2)}
        </span>
      </div>
    {/each}
    <label class="field">
      <span class="lbl">{m.pos_shift_note()}</span>
      <textarea bind:value={note} rows="2"></textarea>
    </label>
  </div>
  {#snippet footer()}
    <button type="button" class="act primary" onclick={submitClose}>{m.pos_shift_close_cta()}</button>
  {/snippet}
</Modal>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    font-size: 13px;
    border-bottom: 1px solid var(--color-border);
  }
  .strip-open {
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    color: #f59e0b;
  }
  .strip-open .msg {
    flex: 1;
  }
  .strip-live {
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    color: var(--color-muted-foreground);
  }
  .strip-live .since {
    flex-shrink: 0;
  }
  .totals {
    flex: 1;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pill {
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .pill.tickets {
    color: var(--color-accent);
  }
  .stale {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, #f87171 15%, transparent);
    color: #f87171;
  }
  .act {
    flex-shrink: 0;
    padding: 5px 12px;
    border-radius: var(--radius-md, 6px);
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .act.primary {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    color: var(--color-accent);
  }
  .act:hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lbl {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted-foreground);
  }
  input[type='number'],
  textarea {
    padding: 6px 10px;
    border-radius: var(--radius-md, 6px);
    border: 1px solid var(--color-border);
    background: var(--color-background);
    color: var(--color-foreground);
    font-size: 13px;
  }
  .close-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border);
  }
  .close-row .lbl {
    width: 70px;
    flex-shrink: 0;
  }
  .expected {
    width: 110px;
    flex-shrink: 0;
    font-size: 12px;
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
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .diff.neg {
    color: #f87171;
  }
  .diff.pos {
    color: #4ade80;
  }
</style>
