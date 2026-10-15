<script lang="ts">
  /**
   * "Mark completed" → confirm what was actually consumed (owner ask
   * 2026-09-25). Every completion passes through here so the realized stock is
   * a confirmed number, not an assumption: each row shows the service's DEFAULT
   * consumption as the reference and an editable ACTUAL beside it (the gauge
   * when the item is diagram-enabled, a numeric field otherwise), with a
   * one-click reset back to the default. Expected stays on the accrual row and
   * actual becomes the stock entry, so expected-vs-reality variance is
   * analysable later.
   *
   * Rows come from each MEMBER's OPEN accruals (`GET /api/stock/accruals`) —
   * a visit is led by a no-consumption service (e.g. "Control") with the real
   * treatment riding as a member, so completion must confirm every member's
   * stock, not just the lead's (owner-reported 2026-10-14: the dialog said
   * "no consumo predeterminado" while the member's accrual realized
   * unconfirmed). When accrue never ran for a member — stock module switched
   * on after the booking, or the product was unmapped then — it falls back to
   * that member's service default consumption map
   * (`GET /api/stock/consumption?finProductId=`). Neither read existing for
   * ANY member (stock module off, no mapping) → empty state + a plain
   * Complete. Confirm POSTs `…/[memberId]/complete` for every member in turn
   * (`completionLinesFor` splits the merged row list back out per member).
   *
   * TODO(handoff): `BookingsView.svelte` (/scheduling bookings list) still
   * carries the THIRD copy of this modal — its own `cdLines`/`completeBooking`
   * pair, without the defaults fallback or the reset affordance. Swap it for
   * this component; left untouched here only because that file belongs to
   * another agent in this batch. Ledger:
   * proposals/2026-09-25-hub-pos-calendar-color-followups.md.
   */
  import { RotateCcw } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { Button, Spinner, iconSizes } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import * as m from '$lib/paraglide/messages';
  import {
    completionLinesFor,
    mergeCompleteResults,
    type CompleteResult,
    type ConsumptionRow,
  } from './consumption-lines';

  export type ConfirmMember = { bookingId: string; productId: string | null; title: string };

  type Props = {
    /** Non-null opens the dialog and triggers the reads. */
    bookingId: string | null;
    /** The booking's service (`booking.productId`) — the no-accrual fallback.
     *  Ignored once `members` is passed. */
    productId?: string | null;
    /** A visit's services to confirm/complete together — one section per
     *  member, one `/complete` POST per member. Omit for the single-booking
     *  sugar (`bookingId`/`productId` become the one member). */
    members?: ConfirmMember[];
    /** Complete endpoint base: the POS calendar passes `/api/pos/appointments`
     *  so POS capabilities gate it (default: scheduling). */
    apiBase?: string;
    onclose: () => void;
    /** Completion succeeded — the host refreshes and surfaces `stockWarning`. */
    oncompleted: (result: CompleteResult) => void | Promise<void>;
  };

  let {
    bookingId,
    productId = null,
    members: membersProp,
    apiBase = '/api/scheduling/bookings',
    onclose,
    oncompleted,
  }: Props = $props();

  const members = $derived(membersProp ?? (bookingId ? [{ bookingId, productId, title: '' }] : []));

  let rows = $state<ConsumptionRow[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let err = $state<string | null>(null);

  /** Both reads 404 when the stock module is off — an absent map is not an error. */
  async function readJson<T>(url: string, fallback: T): Promise<T> {
    try {
      const res = await fetch(url);
      return res.ok ? ((await res.json()) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  type AccrualRow = Record<string, unknown>;
  const num = (v: unknown) => Number(v ?? 0);
  const orNull = (v: unknown) => (v == null ? null : Number(v));

  async function loadRows(
    id: string,
    product: string | null,
  ): Promise<Omit<ConsumptionRow, 'bookingId'>[]> {
    const { accruals } = await readJson<{ accruals: AccrualRow[] }>(
      `/api/stock/accruals?source=booking&sourceId=${id}&status=open`,
      { accruals: [] },
    );
    if (accruals.length)
      return accruals.map((a) => ({
        itemId: a.itemId as string,
        itemName: a.itemName as string,
        uom: a.itemUom as string,
        consumptionUom: (a.consumptionUom as string | null) ?? null,
        unitsPerStockUom: orNull(a.unitsPerStockUom),
        subunitsPerStockUom: orNull(a.subunitsPerStockUom),
        diagramEnabled: Boolean(a.diagramEnabled),
        expected: num(a.qtyConsumption),
        actual: num(a.qtyConsumption),
      }));
    if (!product) return [];
    // TODO(handoff): the defaults fallback posts stk_consumption item ids
    // straight through, but `resolveConsumptionLines` (stock.service.ts) does
    // NOT explode a composite/recipe item into its stock leaves the way
    // `accrueConsumption` does — a service mapped to a recipe item would issue
    // the parent. Only reachable when accrue never ran. Ledger fix belongs in
    // proposals/2026-09-25-hub-pos-calendar-color-followups.md.
    const defaults = await readJson<AccrualRow[]>(
      `/api/stock/consumption?finProductId=${product}`,
      [],
    );
    return defaults.map((d) => ({
      itemId: d.itemId as string,
      itemName: d.itemName as string,
      uom: d.uom as string,
      consumptionUom: (d.consumptionUom as string | null) ?? null,
      unitsPerStockUom: orNull(d.unitsPerStockUom),
      subunitsPerStockUom: orNull(d.subunitsPerStockUom),
      diagramEnabled: Boolean(d.diagramEnabled),
      expected: num(d.qtyPerUnit),
      actual: num(d.qtyPerUnit),
    }));
  }

  let gen = 0;
  $effect(() => {
    const id = bookingId;
    const token = ++gen;
    if (!id) {
      rows = [];
      err = null;
      return;
    }
    // Snapshot: `members` is re-derived from props on every parent render, and
    // only the open/close transition (`bookingId`) should re-trigger the reads.
    const ms = untrack(() => members);
    loading = true;
    err = null;
    void (async () => {
      const loaded = (
        await Promise.all(
          ms.map(async (mb) => {
            const memberRows = await loadRows(mb.bookingId, mb.productId);
            return memberRows.map((r) => ({ ...r, bookingId: mb.bookingId }));
          }),
        )
      ).flat();
      if (token !== gen) return;
      rows = loaded;
      loading = false;
    })();
  });

  const unitOf = (r: ConsumptionRow) => r.consumptionUom ?? r.uom;
  const maxOf = (r: ConsumptionRow) =>
    r.diagramEnabled
      ? gaugeMax({
          uom: r.uom,
          unitsPerStockUom: r.unitsPerStockUom,
          subunitsPerStockUom: r.subunitsPerStockUom,
        })
      : 0;

  async function confirm() {
    if (members.length === 0) return;
    busy = true;
    err = null;
    try {
      // Sequential, not `Promise.all`: each POST sets the booking's own status
      // and realizes its own accrual — no reason to race them against the
      // same stock bins.
      let merged: CompleteResult | null = null;
      for (const mb of members) {
        const res = await fetch(`${apiBase}/${mb.bookingId}/complete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lines: completionLinesFor(rows, mb.bookingId) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        merged = mergeCompleteResults(merged, (await res.json()) as CompleteResult);
      }
      // Host first, close second: the host's handler still needs to know WHICH
      // booking completed (it reads the same state that drives `bookingId`),
      // and closing on refreshed data beats a flash of the stale calendar.
      if (merged) await oncompleted(merged);
      onclose();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }
</script>

<!-- `md`, like the modal this replaced: a gauge row needs the width. -->
<Dialog open={bookingId !== null} title={m.sched_complete_title()} {onclose}>
  <div class="body">
    {#if loading}
      <div class="center"><Spinner /></div>
    {:else if rows.length === 0}
      <p class="t-caption">{m.sched_complete_no_defaults()}</p>
    {:else}
      <p class="t-caption">{m.sched_complete_hint()}</p>
      {#each members as mb (mb.bookingId)}
        {@const memberRows = rows.filter((r) => r.bookingId === mb.bookingId)}
        {#if memberRows.length > 0}
          <!-- A single-member dialog has no caption: the heading would just
               repeat the dialog's own title. -->
          {#if members.length > 1 && mb.title}
            <p class="t-label member-heading">{mb.title}</p>
          {/if}
          {#each memberRows as r (r.itemId)}
            {@const gMax = maxOf(r)}
            <div class="line">
              <div class="line-text">
                <span class="line-name">{r.itemName}</span>
                <span class="t-caption"
                  >{m.sched_complete_expected({ qty: r.expected, unit: unitOf(r) })}</span
                >
              </div>
              {#if gMax > 0}
                <ConsumptionGauge
                  max={gMax}
                  unit={unitOf(r)}
                  bind:value={() => r.actual, (v) => (r.actual = v)}
                />
              {:else}
                <input
                  class="qty"
                  type="number"
                  min="0"
                  step="any"
                  aria-label={r.itemName}
                  value={r.actual}
                  oninput={(e) => (r.actual = Number(e.currentTarget.value) || 0)}
                />
                <span class="t-caption">{unitOf(r)}</span>
              {/if}
              <Button
                size="sm"
                variant="ghost"
                class="reset-btn"
                title={m.sched_complete_reset()}
                aria-label={m.sched_complete_reset()}
                disabled={r.actual === r.expected}
                onclick={() => (r.actual = r.expected)}
              >
                <RotateCcw size={iconSizes.sm} />
              </Button>
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
    {#if err}<p class="t-caption bad">{err}</p>{/if}
  </div>
  {#snippet footer()}
    <div class="acts">
      <Button disabled={busy} loading={busy} onclick={confirm}>
        {rows.length === 0 ? m.sched_mark_complete() : m.sched_complete_confirm()}
      </Button>
      <Button variant="ghost" disabled={busy} onclick={onclose}>{m.sched_cancel()}</Button>
    </div>
  {/snippet}
</Dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .center {
    display: flex;
    justify-content: center;
    padding: var(--space-4);
  }
  .member-heading {
    color: var(--color-text-secondary);
  }
  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .line-text {
    display: flex;
    flex-direction: column;
    min-width: 8rem;
    flex: 1;
  }
  .line-name {
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
  }
  .line :global(.reset-btn) {
    color: var(--color-text-tertiary);
  }
  .qty {
    width: 6rem;
    height: var(--control-height-md);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bad {
    color: var(--color-danger-fg);
  }
</style>
