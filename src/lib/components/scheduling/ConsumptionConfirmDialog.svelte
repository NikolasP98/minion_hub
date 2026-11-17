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
   * `mode="recover_stock"` (spec 126) is the STOCK-ONLY retry of members that are
   * ALREADY completed: it never reads the defaults map and never completes or
   * re-statuses anything. It reads the server's persisted recovery facts for the visit
   * (`GET ${apiBase}/${bookingId}` → `stockRecovery`) and, per eligible member in id
   * order, POSTs `…/complete` sequentially: `{}` to retry a saved stock entry, or the
   * reviewed `lines` plus the `recovery` precondition (open-set count and fingerprint)
   * to confirm the open expectation. A non-2xx or lost response stops the rest.
   */
  import { RotateCcw } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { Button, Spinner, iconSizes } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import * as m from '$lib/paraglide/messages';
  import {
    BOOKING_PRODUCTS_VERSION,
    BOOKING_PRODUCTS_VERSION_HEADER,
    basicMembers,
    decodeBookingDetailWire,
    type RecoveryFacet,
    type StockRecoveryMemberWire,
  } from './booking-product-facets';
  import {
    completionLinesFor,
    mergeCompleteResults,
    mergeConsumptionRows,
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
    oncompleted?: (result: CompleteResult) => void | Promise<void>;
    /** `complete` (default) is the ordinary completion flow; `recover_stock` retries the
     *  stock of already-completed members and never touches a status. */
    mode?: 'complete' | 'recover_stock';
    /** Recovery only: fired after every attempt (the host reloads its detail/list); it must
     *  not complete anything. Receives the per-member outcome. */
    onrecovered?: (results: Record<string, RecoveryOutcome>) => void | Promise<void>;
  };

  export type RecoveryOutcome = 'resolved' | 'warning' | 'error' | 'unknown';

  let {
    bookingId,
    productId = null,
    members: membersProp,
    apiBase = '/api/scheduling/bookings',
    onclose,
    oncompleted,
    mode = 'complete',
    onrecovered,
  }: Props = $props();

  const recovering = $derived(mode === 'recover_stock');

  const members = $derived(membersProp ?? (bookingId ? [{ bookingId, productId, title: '' }] : []));

  let rows = $state<ConsumptionRow[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let err = $state<string | null>(null);
  /** The rows could not be read: confirming now would post an empty list. */
  let loadError = $state(false);

  /** Both reads 404 when the stock module is off (403 without stock access) —
   *  an absent map is not an error. Any other failure throws. */
  async function readJson<T>(url: string, fallback: T): Promise<T> {
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return fallback;
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  }

  type AccrualRow = Record<string, unknown>;
  const num = (v: unknown) => Number(v ?? 0);
  const orNull = (v: unknown) => (v == null ? null : Number(v));

  async function loadRows(
    id: string,
    product: string | null,
  ): Promise<Omit<ConsumptionRow, 'bookingId'>[]> {
    const [{ accruals }, defaults] = await Promise.all([
      readJson<{ accruals: AccrualRow[] }>(
        `/api/stock/accruals?source=booking&sourceId=${id}&status=open`,
        { accruals: [] },
      ),
      // TODO(handoff): the defaults read posts stk_consumption item ids
      // straight through, but `resolveConsumptionLines` (stock.service.ts) does
      // NOT explode a composite/recipe item into its stock leaves the way
      // `accrueConsumption` does — a service mapped to a recipe item would issue
      // the parent. Ledger fix belongs in
      // proposals/2026-09-25-hub-pos-calendar-color-followups.md.
      product
        ? readJson<AccrualRow[]>(`/api/stock/consumption?finProductId=${product}`, [])
        : Promise.resolve([] as AccrualRow[]),
    ]);
    return mergeConsumptionRows(
      accruals.map((a) => ({
        itemId: a.itemId as string,
        itemName: a.itemName as string,
        uom: a.itemUom as string,
        consumptionUom: (a.consumptionUom as string | null) ?? null,
        unitsPerStockUom: orNull(a.unitsPerStockUom),
        subunitsPerStockUom: orNull(a.subunitsPerStockUom),
        diagramEnabled: Boolean(a.diagramEnabled),
        expected: num(a.qtyConsumption),
        actual: num(a.qtyConsumption),
      })),
      defaults.map((d) => ({
        itemId: d.itemId as string,
        itemName: d.itemName as string,
        uom: d.uom as string,
        consumptionUom: (d.consumptionUom as string | null) ?? null,
        unitsPerStockUom: orNull(d.unitsPerStockUom),
        subunitsPerStockUom: orNull(d.subunitsPerStockUom),
        diagramEnabled: Boolean(d.diagramEnabled),
        expected: num(d.qtyPerUnit),
        actual: num(d.qtyPerUnit),
      })),
    );
  }

  let gen = 0;

  // ── recover_stock ───────────────────────────────────────────────────────────
  let facet = $state<RecoveryFacet | null>(null);
  let titles = $state<Record<string, string>>({});
  let outcomes = $state<Record<string, { kind: RecoveryOutcome; message?: string }>>({});
  const eligible = $derived(
    facet?.state === 'available'
      ? facet.value
          .filter((r) => r.eligibility === 'retry_saved' || r.eligibility === 'confirm_open')
          .sort((a, b) => a.bookingId.localeCompare(b.bookingId))
      : [],
  );
  const manual = $derived(
    facet?.state === 'available'
      ? facet.value.filter((r) => r.eligibility === 'manual_review')
      : [],
  );

  /** Fresh persisted facts → rows of the `confirm_open` members (expected = accrued, actual starts equal). */
  async function loadRecovery(id: string) {
    const token = ++gen;
    loading = true;
    loadError = false;
    err = null;
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        headers: { [BOOKING_PRODUCTS_VERSION_HEADER]: String(BOOKING_PRODUCTS_VERSION) },
      });
      if (res.status === 403) {
        if (token === gen) facet = { state: 'denied' };
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const d = decodeBookingDetailWire<object>(await res.json());
      if (token !== gen) return;
      if (!d) throw new Error('refresh_required');
      // The recovery facts ride the stock facet of the versioned envelope; an unavailable or denied
      // stock facet is never "nothing to recover".
      const stock = d.productFacets.stock;
      const next: RecoveryFacet =
        stock.state === 'available'
          ? stock.value.recovery
          : stock.state === 'denied'
            ? { state: 'denied' }
            : { state: 'unavailable', reason: 'invalid_projection' };
      titles = Object.fromEntries(
        basicMembers(d.productFacets).map((x) => [x.id, x.eventTypeTitle]),
      );
      rows = (next.state === 'available' ? next.value : [])
        .filter((r) => r.eligibility === 'confirm_open' && r.confirmation)
        .flatMap((r) =>
          r.confirmation!.rows.map((o) => ({
            bookingId: r.bookingId,
            itemId: o.itemId,
            itemName: o.itemName,
            uom: o.uom,
            consumptionUom: o.consumptionUom,
            unitsPerStockUom: o.unitsPerStockUom,
            subunitsPerStockUom: o.subunitsPerStockUom,
            diagramEnabled: o.diagramEnabled,
            expected: o.qtyConsumption,
            actual: o.qtyConsumption,
          })),
        );
      facet = next;
    } catch {
      if (token === gen) {
        facet = null;
        rows = [];
        loadError = true;
      }
    } finally {
      if (token === gen) loading = false;
    }
  }

  async function recover() {
    if (!recovering || busy || loading || loadError || eligible.length === 0) return;
    busy = true;
    err = null;
    const results: Record<string, RecoveryOutcome> = {};
    const mark = (id: string, kind: RecoveryOutcome, message?: string) => {
      results[id] = kind;
      outcomes = { ...outcomes, [id]: { kind, message } };
    };
    const target = bookingId;
    try {
      // Sequential and in id order. A non-2xx or a lost response stops the rest: the
      // outcome of that member is not known until the persisted facts are read again.
      for (const mb of [...eligible] as StockRecoveryMemberWire[]) {
        const body =
          mb.eligibility === 'retry_saved'
            ? {}
            : {
                lines: completionLinesFor(rows, mb.bookingId) ?? [],
                recovery: {
                  mode: 'confirm_open',
                  expectedOpenCount: mb.confirmation!.openCount,
                  expectedOpenFingerprint: mb.confirmation!.expectedOpenFingerprint,
                },
              };
        let res: Response;
        try {
          res = await fetch(`${apiBase}/${mb.bookingId}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch {
          mark(mb.bookingId, 'unknown');
          break;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          mark(mb.bookingId, 'error');
          if (j?.error === 'recovery_preview_stale') err = m.sched_recover_stale();
          break;
        }
        const j = (await res.json().catch(() => null)) as CompleteResult | null;
        if (j?.stockWarning) mark(mb.bookingId, 'warning', j.stockWarning.message);
        else mark(mb.bookingId, 'resolved');
      }
    } finally {
      busy = false;
    }
    // Host reload first, then the dialog re-reads its own facts: success alone is not proof.
    await onrecovered?.(results);
    if (target) await loadRecovery(target);
    if (eligible.length === 0 && Object.values(results).every((k) => k === 'resolved')) onclose();
  }

  function load(ms: ConfirmMember[]) {
    const token = ++gen;
    loading = true;
    loadError = false;
    err = null;
    void (async () => {
      try {
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
      } catch {
        if (token !== gen) return;
        rows = [];
        loadError = true;
      } finally {
        if (token === gen) loading = false;
      }
    })();
  }
  $effect(() => {
    const id = bookingId;
    if (!id) {
      ++gen;
      rows = [];
      err = null;
      loadError = false;
      facet = null;
      outcomes = {};
      return;
    }
    if (untrack(() => recovering)) {
      outcomes = {};
      void loadRecovery(id);
      return;
    }
    // Snapshot: `members` is re-derived from props on every parent render, and
    // only the open/close transition (`bookingId`) should re-trigger the reads.
    load(untrack(() => members));
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
    if (members.length === 0 || loading || loadError) return;
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
      if (merged) await oncompleted?.(merged);
      onclose();
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      busy = false;
    }
  }
</script>

<!-- `md`, like the modal this replaced: a gauge row needs the width. -->
<Dialog
  open={bookingId !== null}
  title={recovering ? m.sched_recover_title() : m.sched_complete_title()}
  {onclose}
>
  <div class="body">
    {#if loading}
      <div class="center"><Spinner /></div>
    {:else if loadError}
      <div class="acts">
        <p class="t-caption bad" role="alert">{m.common_error()}</p>
        <Button
          size="sm"
          variant="ghost"
          onclick={() => (recovering && bookingId ? loadRecovery(bookingId) : load(members))}
          >{m.common_retry()}</Button
        >
      </div>
    {:else if recovering}
      {#if facet?.state === 'denied'}
        <p class="t-caption">{m.sched_recover_denied()}</p>
      {:else if facet?.state !== 'available' && facet?.state !== 'empty'}
        <!-- Missing or failed evidence is NOT "nothing to recover". -->
        <p class="t-caption bad" role="alert">{m.sched_recover_unavailable()}</p>
      {:else if eligible.length === 0 && manual.length === 0}
        <p class="t-caption">{m.sched_recover_none()}</p>
      {:else}
        {#if eligible.length > 0}<p class="t-caption">{m.sched_recover_hint()}</p>{/if}
        {#each [...eligible, ...manual] as mb (mb.bookingId)}
          {@const memberRows = rows.filter((r) => r.bookingId === mb.bookingId)}
          {@const outcome = outcomes[mb.bookingId]}
          {#if titles[mb.bookingId]}
            <p class="t-label member-heading">{titles[mb.bookingId]}</p>
          {/if}
          {#if mb.eligibility === 'manual_review'}
            <p class="t-caption">{m.sched_recover_manual()}</p>
          {:else if mb.eligibility === 'retry_saved' && mb.sourceEntry}
            <p class="t-caption">
              {m.sched_recover_saved({ status: mb.sourceEntry.status })}
              <a class="crm-link" href={`/stock/entries/${mb.sourceEntry.id}`}
                >{mb.sourceEntry.id.slice(0, 8)}</a
              >
            </p>
          {:else}
            <p class="t-caption">{m.sched_recover_open_hint()}</p>
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
              </div>
            {/each}
          {/if}
          {#if outcome}
            <p class="t-caption" class:bad={outcome.kind === 'error' || outcome.kind === 'unknown'}>
              {#if outcome.kind === 'resolved'}{m.sched_recover_resolved()}
              {:else if outcome.kind === 'warning'}{m.sched_recover_warning({
                  message: outcome.message ?? '',
                })}
              {:else if outcome.kind === 'error'}{m.sched_recover_error()}
              {:else}{m.sched_recover_unknown()}{/if}
            </p>
          {/if}
        {/each}
      {/if}
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
      {#if recovering}
        <Button
          disabled={busy || loading || loadError || eligible.length === 0}
          loading={busy}
          onclick={recover}
        >
          {m.sched_recover_confirm()}
        </Button>
      {:else}
        <Button disabled={busy || loading || loadError} loading={busy} onclick={confirm}>
          {rows.length === 0 ? m.sched_mark_complete() : m.sched_complete_confirm()}
        </Button>
      {/if}
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
