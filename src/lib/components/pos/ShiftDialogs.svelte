<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { isDenied } from '$lib/permissions';

  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { getShiftDialogsController } from './shift-dialogs-context';

  // Mounted ONCE by the POS layout, outside the section nav and the module-mode
  // strip: a native <dialog> under a `display: none` ancestor paints nothing but
  // still blocks the page, and those nodes are hidden on phones.

  const settings = $derived(page.data.posSettings as { methods: PosMethodLike[] });

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

  function zeroedByMethod(): Record<string, number> {
    return Object.fromEntries(enabledMethods.map((mth) => [mth.id, 0]));
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
  let pendingEmit = $state(0);
  // Confirm stays off until THIS opening's totals arrive (spec 116 FR-007).
  let totals = $state<'loading' | 'ready' | 'error'>('loading');
  let closing = $state(false);
  // Bumped per load: an answer that belongs to an earlier opening is dropped.
  let closeGen = 0;

  function startClose() {
    counted = zeroedByMethod();
    note = '';
    closeModal = true;
    void loadTotals();
  }

  // Fresh read so the expected totals reflect any sale that landed after the
  // page's own load (another register tab, a delayed POST, etc). Retry calls
  // this alone, so the counts already typed survive a failed load.
  async function loadTotals() {
    const gen = ++closeGen;
    expected = {};
    pendingEmit = 0;
    totals = 'loading';
    try {
      const res = await fetch('/api/pos/shifts/current');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        shift?: PosShiftLike | null;
        summary?: ShiftSummaryLike;
      };
      if (gen !== closeGen) return;
      if (!data.shift || !data.summary) {
        // Shift already closed elsewhere between opening this menu and now.
        closeModal = false;
        await invalidate('pos:shift');
        return;
      }
      const byMethod = data.summary.byMethod ?? {};
      const float = data.shift.openingFloat ?? {};
      pendingEmit = data.summary.unemitted ?? 0;
      const next = { ...byMethod };
      for (const mth of settings.methods) {
        if (!mth.takesTendered) continue;
        next[mth.id] = (next[mth.id] ?? 0) + Number(float[mth.id] ?? 0);
      }
      expected = next;
      totals = 'ready';
    } catch {
      if (gen === closeGen) totals = 'error';
    }
  }

  function difference(mth: string): number {
    return Math.round(((counted[mth] ?? 0) - (expected[mth] ?? 0)) * 100) / 100;
  }

  async function submitClose() {
    if (closing || totals !== 'ready') return;
    closing = true;
    try {
      await sendClose();
    } finally {
      closing = false;
    }
  }

  function sendClose() {
    return toastAsync(
      (async () => {
        const res = await fetch('/api/pos/shifts/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Recorded methods are filled in by the server from its own totals.
          body: JSON.stringify({
            counted: Object.fromEntries(countedMethods.map((mth) => [mth.id, counted[mth.id]])),
            note: note || null,
          }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Failed to close shift (${res.status})`);
        }
        const d = (await res.json().catch(() => ({}))) as {
          shift?: { emission?: { queued: number } | null };
        };
        closeModal = false;
        await invalidate('pos:shift');
        return d.shift?.emission?.queued ?? 0;
      })(),
      {
        loading: `${m.pos_shift_close_cta()}…`,
        getOutcome: (queued: number) => ({
          type: 'success',
          title: m.pos_shift_close_cta(),
          ...(queued ? { description: m.pos_shift_closed_emitted({ count: String(queued) }) } : {}),
        }),
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

  // Same pos:edit gate as the banner buttons: callers elsewhere (the calendar
  // sheet) go through this too, so the gate lives with the dialogs.
  getShiftDialogsController()?.register({
    startOpen: () => {
      if (canAct('pos', 'edit')) startOpen();
    },
    startClose: () => {
      if (canAct('pos', 'edit')) startClose();
    },
  });
</script>

<!-- No denied caption here: the banner shows it; this host renders nothing without POS data. -->
{#if !isDenied(page.data.posSettings)}
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
      <Button type="button" class="act primary" onclick={submitOpen}
        >{m.pos_shift_open_cta()}</Button
      >
    {/snippet}
  </Modal>

  <Modal bind:open={closeModal} title={m.pos_shift_close_cta()} size="lg">
    <div class="form">
      {#if totals === 'error'}
        <div class="totals-failed">
          <p role="status">{m.pos_shift_totals_failed()}</p>
          <Button type="button" size="sm" onclick={loadTotals}>{m.common_retry()}</Button>
        </div>
      {/if}
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
      {#if pendingEmit > 0}
        <p class="lbl">{m.pos_shift_close_emit({ count: String(pendingEmit) })}</p>
      {/if}
    </div>
    {#snippet footer()}
      <Button
        type="button"
        class="act primary"
        disabled={totals !== 'ready' || closing}
        onclick={submitClose}>{m.pos_shift_close_cta()}</Button
      >
    {/snippet}
  </Modal>
{/if}

<style>
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
  .totals-failed {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-danger-fg);
  }
  .totals-failed p {
    margin: 0;
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
