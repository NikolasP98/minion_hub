<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { ShoppingCart, LayoutGrid, List, Receipt, History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, Button, EmptyState, Popover } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { createHotkey } from '$lib/hotkeys';
  import { toastAsync, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import SellCart, { type CartLine, lineCents } from '$lib/components/pos/SellCart.svelte';
  import PaymentPanel, { type PaymentRow } from '$lib/components/pos/PaymentPanel.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();

  // ── Cart persistence ── keyed per-org: (app)/+layout.server.ts exposes
  // `activeOrgId` top-level in page.data, so carts never bleed across orgs.
  const CART_KEY = `pos-cart-${page.data.activeOrgId ?? 'default'}`;

  function loadCart(sellables: PageData['sellables']): CartLine[] {
    if (!browser) return [];
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      const stored = JSON.parse(raw) as Array<{
        productId: string;
        qty: number;
        unitPrice: number | null;
        discount: number;
        bookingId?: string | null;
      }>;
      const byId = new Map(sellables.map((s) => [s.productId, s]));
      // Stale entries (product deleted/deactivated since the cart was saved)
      // are dropped, not crashed on.
      return stored.flatMap((entry) => {
        const sellable = byId.get(entry.productId);
        if (!sellable) return [];
        return [
          {
            sellable,
            qty: entry.qty,
            unitPrice: entry.unitPrice,
            discount: entry.discount,
            bookingId: entry.bookingId ?? null,
          },
        ];
      });
    } catch {
      return [];
    }
  }

  // svelte-ignore state_referenced_locally -- seed cart once from localStorage + the load's sellables snapshot
  let lines = $state<CartLine[]>(loadCart(data.sellables));
  $effect(() => {
    if (!browser) return;
    localStorage.setItem(
      CART_KEY,
      JSON.stringify(
        lines.map((l) => ({
          productId: l.sellable.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discount: l.discount,
          bookingId: l.bookingId ?? null,
        })),
      ),
    );
  });

  // ── Catalog ──
  let search = $state('');
  let activeCategory = $state<string | null>(null);
  let searchEl: HTMLInputElement | undefined = $state();

  const VIEW_KEY = 'pos-sell-view';
  let view = $state<'gallery' | 'table'>(
    browser && localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'gallery',
  );
  $effect(() => {
    if (browser) localStorage.setItem(VIEW_KEY, view);
  });

  createHotkey('/', () => searchEl?.focus(), { meta: { name: m.pos_sell_search_placeholder() } });

  const categories = $derived(
    Array.from(new Set(data.sellables.map((s) => s.category ?? 'uncategorized'))).sort(),
  );
  const filtered = $derived(
    data.sellables.filter((s) => {
      if (activeCategory && (s.category ?? 'uncategorized') !== activeCategory) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    }),
  );

  function stockBadgeValue(qty: number): 'success' | 'warning' | 'error' {
    if (qty > 10) return 'success';
    if (qty > 0) return 'warning';
    return 'error';
  }

  // Newest (or just-bumped) line always surfaces at the top of the cart.
  function addLine(sellable: PageData['sellables'][number]) {
    const i = lines.findIndex((l) => l.sellable.productId === sellable.productId);
    if (i >= 0) {
      const existing = lines[i];
      existing.qty += 1;
      lines = [existing, ...lines.filter((_, idx) => idx !== i)];
    } else {
      lines = [{ sellable, qty: 1, unitPrice: sellable.unitPrice, discount: 0 }, ...lines];
    }
  }

  type Sellable = PageData['sellables'][number];
  const tableColumns = $derived<DataColumn<Sellable>[]>([
    { key: 'name', label: m.pos_sell_col_name(), custom: true, accessor: (s) => s.name },
    { key: 'category', label: m.pos_sell_col_category(), accessor: (s) => s.category ?? '—' },
    {
      key: 'unitPrice',
      money: true,
      label: m.pos_sell_price(),
      align: 'right',
      custom: true,
      accessor: (s) => s.unitPrice ?? '',
    },
    {
      key: 'stockQty',
      label: m.pos_catalog_col_stock(),
      align: 'right',
      custom: true,
      accessor: (s) => s.stockQty ?? '',
    },
  ]);

  // ── Customer + payments ──
  let partyId = $state<string | null>(null);
  let customerName = $state<string | null>(null);
  let customerPhone = $state<string | null>(null);
  let payments = $state<PaymentRow[]>([]);

  // ── Booking → charge handoff ── the appointments tab writes the completed
  // booking here and navigates over; consume-once so a reload doesn't re-add.
  const CHARGE_KEY = `pos-charge-${page.data.activeOrgId ?? 'default'}`;
  if (browser) {
    try {
      const raw = localStorage.getItem(CHARGE_KEY);
      if (raw) {
        localStorage.removeItem(CHARGE_KEY);
        const h = JSON.parse(raw) as {
          bookingId: string;
          productId: string | null;
          partyId?: string | null;
          customerName?: string | null;
          phone?: string | null;
        };
        // svelte-ignore state_referenced_locally -- consume-once init, same idiom as loadCart above
        const sellable = h.productId
          ? data.sellables.find((s) => s.productId === h.productId)
          : undefined;
        if (sellable) {
          // svelte-ignore state_referenced_locally -- init-time read of the just-seeded cart
          if (!lines.some((l) => l.bookingId === h.bookingId)) {
            lines = [
              { sellable, qty: 1, unitPrice: sellable.unitPrice, discount: 0, bookingId: h.bookingId },
              // svelte-ignore state_referenced_locally -- init-time spread of the just-seeded cart
              ...lines,
            ];
          }
          toastSuccess(m.pos_booking_loaded());
        } else {
          toastWarning(m.pos_booking_product_missing());
        }
        partyId = h.partyId ?? null;
        customerName = h.customerName ?? null;
        customerPhone = h.phone ?? null;
      }
    } catch {
      /* malformed handoff — ignore */
    }
  }

  const totalCents = $derived(lines.reduce((s, l) => s + lineCents(l), 0));
  const total = $derived(totalCents / 100);
  const anyPriceless = $derived(lines.some((l) => l.unitPrice == null || l.unitPrice <= 0));
  const paidCents = $derived(payments.reduce((s, p) => s + Math.round(p.amount * 100), 0));
  const remainingCents = $derived(totalCents - paidCents);
  const tenderOk = $derived(
    payments.every(
      (p) =>
        p.method !== 'cash' ||
        p.tendered == null ||
        Math.round(p.tendered * 100) >= Math.round(p.amount * 100),
    ),
  );
  const customerMissing = $derived(data.posSettings.requireCustomer && !partyId && !customerName);
  // Server rejects tickets without an open shift (no_open_shift) — mirror that
  // in the UI so the cashier can't even try.
  const shiftOpen = $derived(!!page.data.openShift);
  let submitting = $state(false);
  const chargeDisabled = $derived(
    !shiftOpen ||
      lines.length === 0 ||
      anyPriceless ||
      customerMissing ||
      paidCents !== totalCents ||
      !tenderOk ||
      submitting,
  );
  // First unmet precondition, in fix-order — shown ON the charge button so a
  // disabled button is never silent (one blocker at a time, not a checklist).
  const chargeBlocker = $derived.by(() => {
    if (!shiftOpen) return m.pos_no_open_shift();
    if (lines.length === 0) return m.pos_charge_blocked_empty();
    const unpriced = lines.find((l) => l.unitPrice == null || l.unitPrice <= 0);
    if (unpriced) return m.pos_charge_blocked_price({ name: unpriced.sellable.name });
    if (customerMissing) return m.pos_customer_required();
    if (paidCents < totalCents)
      return m.pos_charge_blocked_remaining({ amount: formatMoney(remainingCents / 100) });
    if (!tenderOk) return m.pos_charge_blocked_tender();
    return null;
  });

  // ── Submit ──
  let stockBanner = $state<{ ticketId: string; message: string } | null>(null);

  async function charge() {
    if (chargeDisabled) return;
    submitting = true;
    try {
      const result = await toastAsync(
        (async () => {
          const res = await fetch('/api/pos/tickets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              lines: lines.map((l) => ({
                kind: l.sellable.kind,
                finProductId: l.sellable.productId,
                bookingId: l.bookingId ?? null,
                description: l.sellable.name,
                qty: l.qty,
                unitPrice: l.unitPrice ?? 0,
                discount: l.discount,
              })),
              payments: payments.map((p) => ({
                method: p.method,
                amount: p.amount,
                tendered: p.method === 'cash' ? (p.tendered ?? p.amount) : null,
              })),
              partyId,
              customerName,
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) {
            const err = new Error(j?.error ?? `Failed (${res.status})`) as Error & {
              code?: string;
            };
            err.code = j?.code;
            throw err;
          }
          return j as {
            ok: true;
            ticket: { id: string; humanId: string | null };
            stockWarning: { message: string } | null;
          };
        })(),
        {
          loading: `${m.pos_sell_charge()}…`,
          getOutcome: (r) => ({
            type: r.stockWarning ? 'warning' : 'success',
            title: m.pos_sell_success({ humanId: r.ticket.humanId ?? '—' }),
            description: r.stockWarning
              ? m.pos_stock_warning({ message: r.stockWarning.message })
              : undefined,
          }),
          onError: (err) => {
            const code = (err as { code?: string } | undefined)?.code;
            if (code === 'no_open_shift') return { title: m.pos_no_open_shift() };
            return {
              title: m.pos_sell_charge(),
              description: err instanceof Error ? err.message : String(err),
            };
          },
        },
      );
      stockBanner = result.stockWarning
        ? { ticketId: result.ticket.id, message: result.stockWarning.message }
        : null;
      lines = [];
      payments = [];
      partyId = null;
      customerName = null;
      customerPhone = null;
      await invalidate('pos:shift');
      await invalidate('pos:sell');
    } catch {
      // toastAsync already surfaced the failure
    } finally {
      submitting = false;
    }
  }

  async function retryStock() {
    if (!stockBanner) return;
    const id = stockBanner.ticketId;
    try {
      const result = await toastAsync(
        (async () => {
          const res = await fetch(`/api/pos/tickets/${id}/post-stock`, { method: 'POST' });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error ?? `Failed (${res.status})`);
          return j as {
            ok: true;
            entryId: string | null;
            stockWarning: { message: string } | null;
          };
        })(),
        {
          loading: `${m.pos_post_stock_retry()}…`,
          getOutcome: (r) => ({
            type: r.stockWarning ? 'warning' : 'success',
            title: m.pos_post_stock_retry(),
          }),
        },
      );
      stockBanner = result.stockWarning
        ? { ticketId: id, message: result.stockWarning.message }
        : null;
      await invalidate('pos:sell');
    } catch {
      /* toastAsync already surfaced */
    }
  }

  // ── Recent sales + shift history (popovers next to the search bar) ──
  async function voidTicketRow(id: string) {
    if (!confirm(m.pos_void_confirm())) return;
    const res = await fetch(`/api/pos/tickets/${id}/void`, { method: 'POST' });
    if (res.ok) {
      await invalidate('pos:sell');
      await invalidate('pos:shift');
    }
  }

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<svelte:head><title>{m.pos_nav_sell()} — {m.nav_pos()}</title></svelte:head>

<PageShell
  archetype="workspace"
  scroll="region"
  labelledBy="pos-sell-title"
  class="pos-sell-surface"
>
  <PageHeader titleId="pos-sell-title" title={m.pos_nav_sell()}>
    {#snippet leading()}<ShoppingCart size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    <div class="layout">
      <div class="catalog">
        <div class="catalog-head">
          <div class="search-row">
            <input
              class="search-inp"
              placeholder={m.pos_sell_search_placeholder()}
              bind:value={search}
              bind:this={searchEl}
            />

            <Popover placement="bottom">
              {#snippet trigger()}
                <span class="hbtn" title={m.pos_recent_sales()}>
                  <Receipt size={14} />
                  <span class="hbtn-label">{m.pos_recent_sales()}</span>
                </span>
              {/snippet}
              <div class="hpanel">
                <h2 class="section-h">{m.pos_recent_sales()}</h2>
                {#if data.recentTickets.length === 0}
                  <EmptyState title={m.common_noMatches()} compact />
                {:else}
                  <div class="ticket-list">
                    {#each data.recentTickets as t (t.id)}
                      <div class="ticket-row">
                        <span class="tid">{t.humanId ?? '—'}</span>
                        <span class="ttime">{fmtTime(t.submittedAt)}</span>
                        <span class="ttotal">{formatMoney(t.total)}</span>
                        <span class="tcust">{t.customerName ?? '—'}</span>
                        {#if t.status === 'void'}
                          <Badge variant="semantic" value="error" size="sm">{m.pos_void()}</Badge>
                        {:else if t.stockEntryId}
                          <a
                            href={`/stock/entries/${t.stockEntryId}`}
                            title={m.pos_sell_view_entry()}
                            class="stock-chip ok">✓</a
                          >
                        {:else if t.stockWarning}
                          <span
                            class="stock-chip warn"
                            title={(t.stockWarning as { message: string }).message}>⚠</span
                          >
                        {/if}
                        {#if t.status !== 'void' && canAct('pos', 'manage')}
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            class="void-btn"
                            onclick={() => voidTicketRow(t.id)}>{m.pos_void()}</Button
                          >
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </Popover>

            <Popover placement="bottom">
              {#snippet trigger()}
                <span class="hbtn" title={m.pos_sell_shifts_history()}>
                  <History size={14} />
                  <span class="hbtn-label">{m.pos_sell_shifts_history()}</span>
                </span>
              {/snippet}
              <div class="hpanel">
                <h2 class="section-h">{m.pos_sell_shifts_history()}</h2>
                {#if data.shifts.length === 0}
                  <EmptyState title={m.common_noMatches()} compact />
                {:else}
                  <div class="shift-list">
                    {#each data.shifts as s (s.id)}
                      <div class="shift-row">
                        <span class="stime">{fmtTime(s.openedAt)}</span>
                        <span class="stime"
                          >{s.closedAt ? fmtTime(s.closedAt) : m.pos_sell_shift_status_open()}</span
                        >
                        {#if s.expected}
                          <div class="diffs">
                            {#each Object.keys(s.expected as Record<string, number>) as mth (mth)}
                              {@const exp = (s.expected as Record<string, number>)[mth] ?? 0}
                              {@const cnt =
                                (s.counted as Record<string, number> | null)?.[mth] ?? 0}
                              {@const diff = Math.round((cnt - exp) * 100) / 100}
                              <Badge
                                variant="semantic"
                                value={Math.abs(diff) < 0.01 ? 'success' : 'warning'}
                                size="sm">{mth}: {formatMoney(diff)}</Badge
                              >
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </Popover>
          </div>
          <div class="chips-row">
            <div class="chips">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class={`chip-btn ${activeCategory === null ? 'on' : ''}`}
                aria-pressed={activeCategory === null}
                onclick={() => (activeCategory = null)}
              >
                {m.pos_sell_all_categories()}
              </Button>
              {#each categories as c (c)}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  class={`chip-btn ${activeCategory === c ? 'on' : ''}`}
                  aria-pressed={activeCategory === c}
                  onclick={() => (activeCategory = c)}>{c}</Button
                >
              {/each}
            </div>
            <div class="view-toggle" role="group" aria-label={m.pos_sell_view_gallery()}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class={`vt-btn ${view === 'gallery' ? 'on' : ''}`}
                aria-pressed={view === 'gallery'}
                title={m.pos_sell_view_gallery()}
                aria-label={m.pos_sell_view_gallery()}
                onclick={() => (view = 'gallery')}
              >
                <LayoutGrid size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class={`vt-btn ${view === 'table' ? 'on' : ''}`}
                aria-pressed={view === 'table'}
                title={m.pos_sell_view_table()}
                aria-label={m.pos_sell_view_table()}
                onclick={() => (view = 'table')}
              >
                <List size={14} />
              </Button>
            </div>
          </div>
        </div>

        {#if view === 'gallery'}
          <div class="catalog-scroll">
            {#if filtered.length === 0}
              <EmptyState title={m.pos_sell_no_results()} compact />
            {:else}
              <div class="grid">
                {#each filtered as s (s.productId)}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    class="card"
                    onclick={() => addLine(s)}
                  >
                    <span class="cname">{s.name}</span>
                    <span class="cprice"
                      >{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span
                    >
                    {#if s.kind === 'product' && s.stockQty != null}
                      <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm"
                        >{s.stockQty}</Badge
                      >
                    {/if}
                  </Button>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Shared DataTable, stripped for POS: no toolbar chrome, row click adds. -->
          <div class="table-wrap">
            <DataTable
              class="flex-1 min-h-0"
              columns={tableColumns}
              data={filtered}
              getRowId={(s) => s.productId}
              searchable={false}
              columnMenu={false}
              reorderable={false}
              resizable={false}
              onRowClick={(s) => addLine(s)}
              emptyMessage={m.pos_sell_no_results()}
            >
              {#snippet cell(s: Sellable, col: DataColumn<Sellable>)}
                {#if col.key === 'name'}
                  <span class="tname">{s.name}<span class="tcode">{s.code}</span></span>
                {:else if col.key === 'unitPrice'}
                  <span class="tabular-nums"
                    >{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span
                  >
                {:else if col.key === 'stockQty'}
                  {#if s.kind === 'product' && s.stockQty != null}
                    <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm"
                      >{s.stockQty}</Badge
                    >
                  {:else}
                    —
                  {/if}
                {/if}
              {/snippet}
            </DataTable>
          </div>
        {/if}
      </div>

      <div class="cart-panel">
        {#if stockBanner}
          <div class="banner">
            <span>{m.pos_stock_warning({ message: stockBanner.message })}</span>
            <Button size="sm" variant="outline" onclick={retryStock}
              >{m.pos_post_stock_retry()}</Button
            >
          </div>
        {/if}
        <CustomerPicker
          bind:partyId
          bind:customerName
          bind:phone={customerPhone}
          required={data.posSettings.requireCustomer}
        />
        <div class="cart-scroll">
          <SellCart
            bind:lines
            settings={{ allowPriceOverride: data.posSettings.allowPriceOverride }}
          />
        </div>
        <div class="charge-bar">
          <PaymentPanel {total} methods={data.posSettings.methods} bind:payments />
          <div class="total-row">
            <span>{m.pos_sell_total()}</span>
            <span class="total">{formatMoney(total)}</span>
          </div>
          <div class="remaining" class:done={remainingCents === 0}>
            {m.pos_sell_remaining()}: {formatMoney(remainingCents / 100)}
          </div>
          <Button
            variant="primary"
            size="lg"
            disabled={chargeDisabled}
            loading={submitting}
            onclick={charge}>{chargeBlocker ?? m.pos_sell_charge()}</Button
          >
        </div>
      </div>
    </div>
  </PageBody>
</PageShell>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4, 16px);
  }
  /* Desktop/tablet-landscape: the layout fills the visible scrollport so each
     column scrolls internally — search/filters and the charge bar stay put.
     Recent sales remain reachable below via the page scroll. */
  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: 1fr 380px;
      grid-template-rows: minmax(0, 1fr);
      height: 100%;
    }
  }
  .catalog {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    min-width: 0;
    min-height: 0;
  }
  .catalog-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    flex-shrink: 0;
  }
  /* Mobile: the page itself scrolls — keep search/filters pinned on top. */
  @media (max-width: 1023.98px) {
    .catalog-head {
      position: sticky;
      top: -1rem; /* cancels the scroll container's p-4 */
      /* Sticky = stacking context, so the history popovers inside are capped
         at this z — must beat the DataTable sticky header and the sticky
         charge bar, or they paint over the open panel. */
      z-index: var(--layer-popover, 30);
      background: var(--color-canvas);
      padding: var(--space-4, 16px) 0 var(--space-2, 8px);
      margin-top: calc(-1 * var(--space-4, 16px));
    }
  }
  .catalog-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .chips-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2, 8px);
  }
  .search-row {
    display: flex;
    align-items: stretch;
    gap: var(--space-2, 8px);
  }
  .search-row .search-inp {
    flex: 1;
    min-width: 0;
  }
  /* History buttons (recent sales / shift history) — popover triggers. */
  .hbtn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    height: 100%;
    min-height: 2.2rem;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body, 14px);
    white-space: nowrap;
  }
  .hbtn:hover {
    border-color: var(--color-accent);
    color: var(--color-foreground);
  }
  @media (max-width: 640px) {
    .hbtn-label {
      display: none;
    }
  }
  .hpanel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    width: min(34rem, 92vw);
    max-height: min(60vh, 30rem);
    overflow-y: auto;
    padding: var(--space-2, 8px);
  }
  .search-inp {
    min-height: 2.2rem;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
    flex: 1;
    min-width: 0;
  }
  .view-toggle {
    display: flex;
    gap: var(--space-1, 4px);
    flex-shrink: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-0-5, 2px);
    background: var(--color-bg3);
  }
  :global(.pos-sell-surface .vt-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  :global(.pos-sell-surface .vt-btn.on) {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.pos-sell-surface .chip-btn) {
    padding: var(--space-1, 4px) var(--space-3, 12px);
    border-radius: var(--radius-full);
    border: 1px solid var(--hairline);
    background: var(--color-bg3);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption, 12px);
    cursor: pointer;
  }
  :global(.pos-sell-surface .chip-btn.on) {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-2, 8px);
  }
  :global(.pos-sell-surface .card) {
    height: auto;
    align-items: stretch;
    padding: var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    text-align: left;
    cursor: pointer;
  }
  :global(.pos-sell-surface .card > span) {
    width: 100%;
    /* Without this the flex item's automatic minimum is its (nowrap) content,
       so a long sellable name widens the card past its grid track and the
       whole catalog — and with it the cart panel below — overflows sideways. */
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1, 4px);
  }
  :global(.pos-sell-surface .card:hover) {
    border-color: var(--color-accent);
  }
  .cname {
    /* Button's base class is `whitespace-nowrap`; sellable names are long
       ("Contorno Mandibular (Saypha Volume Plus)") and must wrap inside the
       card instead of pushing the grid wider than the viewport. */
    width: 100%;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: var(--font-size-body, 14px);
    font-weight: 500;
  }
  .cprice {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  /* ── Catalog table view (shared DataTable needs a height-bounded parent) ── */
  .table-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  @media (max-width: 1023.98px) {
    .table-wrap {
      height: 60vh;
    }
  }
  .tname {
    display: flex;
    align-items: baseline;
    gap: var(--space-2, 8px);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 500;
  }
  .tcode {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .cart-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px);
    min-height: 0;
  }
  @media (min-width: 1024px) {
    .cart-panel {
      align-self: start;
      max-height: 100%;
    }
  }
  .cart-scroll {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  /* Children must keep their natural height and overflow the scroller — the
     default flex-shrink:1 compresses them so their contents overlap instead. */
  .cart-scroll > :global(*) {
    flex-shrink: 0;
  }
  /* Total + Charge always visible: pinned inside the panel on desktop, stuck to
     the viewport bottom while the page scrolls on mobile. */
  .charge-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    background: var(--color-card);
    border-top: 1px solid var(--hairline);
    padding: var(--space-2, 8px) var(--space-3, 12px) var(--space-3, 12px);
    margin: 0 calc(-1 * var(--space-3)) calc(-1 * var(--space-3));
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }
  .total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-size-page-title, 18px);
    font-weight: 600;
  }
  .total {
    font-variant-numeric: tabular-nums;
  }
  .remaining {
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    text-align: right;
    color: var(--color-destructive);
  }
  .remaining.done {
    color: var(--color-success);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-warning) 14%, transparent);
    color: var(--color-warning);
    font-size: var(--font-size-caption, 12px);
  }
  .section-h {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .ticket-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .ticket-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: var(--font-size-body, 14px);
  }
  .tid {
    font-variant-numeric: tabular-nums;
    min-width: 6rem;
  }
  .ttime {
    color: var(--color-muted-foreground);
    min-width: 7rem;
  }
  .ttotal {
    font-variant-numeric: tabular-nums;
    min-width: 4rem;
    text-align: right;
  }
  .tcust {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted-foreground);
  }
  .stock-chip.ok {
    color: var(--color-success);
  }
  .stock-chip.warn {
    color: var(--color-warning);
  }
  :global(.pos-sell-surface .void-btn) {
    background: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-destructive);
    cursor: pointer;
  }
  .shift-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .shift-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: var(--font-size-caption, 12px);
  }
  .stime {
    color: var(--color-muted-foreground);
    min-width: 9rem;
  }
  .diffs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }
</style>
