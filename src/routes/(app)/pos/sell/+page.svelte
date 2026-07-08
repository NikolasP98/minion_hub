<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import { ShoppingCart, ChevronDown, LayoutGrid, List } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, Button, EmptyState } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { createHotkey } from '$lib/hotkeys';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import SellCart, { type CartLine, lineCents } from '$lib/components/pos/SellCart.svelte';
  import PaymentPanel, { type PaymentRow } from '$lib/components/pos/PaymentPanel.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';

  let { data }: { data: PageData } = $props();

  // ── Cart persistence ── keyed per-org: (app)/+layout.server.ts exposes
  // `activeOrgId` top-level in page.data, so carts never bleed across orgs.
  const CART_KEY = `pos-cart-${page.data.activeOrgId ?? 'default'}`;

  function loadCart(sellables: PageData['sellables']): CartLine[] {
    if (!browser) return [];
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      const stored = JSON.parse(raw) as Array<{ productId: string; qty: number; unitPrice: number | null; discount: number }>;
      const byId = new Map(sellables.map((s) => [s.productId, s]));
      // Stale entries (product deleted/deactivated since the cart was saved)
      // are dropped, not crashed on.
      return stored.flatMap((entry) => {
        const sellable = byId.get(entry.productId);
        if (!sellable) return [];
        return [{ sellable, qty: entry.qty, unitPrice: entry.unitPrice, discount: entry.discount }];
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
      JSON.stringify(lines.map((l) => ({ productId: l.sellable.productId, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount }))),
    );
  });

  // ── Catalog ──
  let search = $state('');
  let activeCategory = $state<string | null>(null);
  let searchEl: HTMLInputElement | undefined = $state();

  const VIEW_KEY = 'pos-sell-view';
  let view = $state<'gallery' | 'table'>(browser && localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'gallery');
  $effect(() => {
    if (browser) localStorage.setItem(VIEW_KEY, view);
  });

  createHotkey('/', () => searchEl?.focus(), { meta: { name: m.pos_sell_search_placeholder() } });

  const categories = $derived(Array.from(new Set(data.sellables.map((s) => s.category ?? 'uncategorized'))).sort());
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

  function addLine(sellable: PageData['sellables'][number]) {
    const existing = lines.find((l) => l.sellable.productId === sellable.productId);
    if (existing) existing.qty += 1;
    else lines = [...lines, { sellable, qty: 1, unitPrice: sellable.unitPrice, discount: 0 }];
  }

  // ── Customer + payments ──
  let crmContactId = $state<string | null>(null);
  let customerName = $state<string | null>(null);
  let payments = $state<PaymentRow[]>([]);

  const totalCents = $derived(lines.reduce((s, l) => s + lineCents(l), 0));
  const total = $derived(totalCents / 100);
  const anyPriceless = $derived(lines.some((l) => l.unitPrice == null || l.unitPrice <= 0));
  const paidCents = $derived(payments.reduce((s, p) => s + Math.round(p.amount * 100), 0));
  const remainingCents = $derived(totalCents - paidCents);
  const tenderOk = $derived(payments.every((p) => p.method !== 'cash' || p.tendered == null || Math.round(p.tendered * 100) >= Math.round(p.amount * 100)));
  const customerMissing = $derived(data.posSettings.requireCustomer && !crmContactId && !customerName);
  let submitting = $state(false);
  const chargeDisabled = $derived(lines.length === 0 || anyPriceless || customerMissing || paidCents !== totalCents || !tenderOk || submitting);

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
              crmContactId,
              customerName,
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) {
            const err = new Error(j?.error ?? `Failed (${res.status})`) as Error & { code?: string };
            err.code = j?.code;
            throw err;
          }
          return j as { ok: true; ticket: { id: string; humanId: string | null }; stockWarning: { message: string } | null };
        })(),
        {
          loading: `${m.pos_sell_charge()}…`,
          getOutcome: (r) => ({
            type: r.stockWarning ? 'warning' : 'success',
            title: m.pos_sell_success({ humanId: r.ticket.humanId ?? '—' }),
            description: r.stockWarning ? m.pos_stock_warning({ message: r.stockWarning.message }) : undefined,
          }),
          onError: (err) => {
            const code = (err as { code?: string } | undefined)?.code;
            if (code === 'no_open_shift') return { title: m.pos_no_open_shift() };
            return { title: m.pos_sell_charge(), description: err instanceof Error ? err.message : String(err) };
          },
        },
      );
      stockBanner = result.stockWarning ? { ticketId: result.ticket.id, message: result.stockWarning.message } : null;
      lines = [];
      payments = [];
      crmContactId = null;
      customerName = null;
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
          return j as { ok: true; entryId: string | null; stockWarning: { message: string } | null };
        })(),
        {
          loading: `${m.pos_post_stock_retry()}…`,
          getOutcome: (r) => ({ type: r.stockWarning ? 'warning' : 'success', title: m.pos_post_stock_retry() }),
        },
      );
      stockBanner = result.stockWarning ? { ticketId: id, message: result.stockWarning.message } : null;
      await invalidate('pos:sell');
    } catch {
      /* toastAsync already surfaced */
    }
  }

  // ── Recent sales + shift history ──
  let shiftsOpen = $state(false);

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

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.pos_nav_sell()}>
    {#snippet leading()}<ShoppingCart size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="layout">
      <div class="catalog">
        <div class="catalog-head">
          <input class="search-inp" placeholder={m.pos_sell_search_placeholder()} bind:value={search} bind:this={searchEl} />
          <div class="chips-row">
            <div class="chips">
              <button type="button" class="chip-btn" class:on={activeCategory === null} onclick={() => (activeCategory = null)}>
                {m.pos_sell_all_categories()}
              </button>
              {#each categories as c (c)}
                <button type="button" class="chip-btn" class:on={activeCategory === c} onclick={() => (activeCategory = c)}>{c}</button>
              {/each}
            </div>
            <div class="view-toggle" role="group" aria-label={m.pos_sell_view_gallery()}>
              <button
                type="button"
                class="vt-btn"
                class:on={view === 'gallery'}
                title={m.pos_sell_view_gallery()}
                aria-label={m.pos_sell_view_gallery()}
                onclick={() => (view = 'gallery')}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                class="vt-btn"
                class:on={view === 'table'}
                title={m.pos_sell_view_table()}
                aria-label={m.pos_sell_view_table()}
                onclick={() => (view = 'table')}
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        <div class="catalog-scroll">
          {#if filtered.length === 0}
            <EmptyState title={m.pos_sell_no_results()} compact />
          {:else if view === 'gallery'}
            <div class="grid">
              {#each filtered as s (s.productId)}
                <button type="button" class="card" onclick={() => addLine(s)}>
                  <span class="cname">{s.name}</span>
                  <span class="cprice">{s.unitPrice != null ? s.unitPrice.toFixed(2) : '—'}</span>
                  {#if s.kind === 'product' && s.stockQty != null}
                    <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm">{s.stockQty}</Badge>
                  {/if}
                </button>
              {/each}
            </div>
          {:else}
            <div class="ptable">
              <div class="trow thead">
                <span>{m.pos_sell_col_name()}</span>
                <span class="tcat">{m.pos_sell_col_category()}</span>
                <span class="num">{m.pos_sell_price()}</span>
                <span class="num">{m.pos_catalog_col_stock()}</span>
              </div>
              {#each filtered as s (s.productId)}
                <button type="button" class="trow" onclick={() => addLine(s)}>
                  <span class="tname">{s.name}<span class="tcode">{s.code}</span></span>
                  <span class="tcat">{s.category ?? '—'}</span>
                  <span class="num">{s.unitPrice != null ? s.unitPrice.toFixed(2) : '—'}</span>
                  <span class="num">
                    {#if s.kind === 'product' && s.stockQty != null}
                      <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm">{s.stockQty}</Badge>
                    {:else}
                      —
                    {/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="cart-panel">
        {#if stockBanner}
          <div class="banner">
            <span>{m.pos_stock_warning({ message: stockBanner.message })}</span>
            <Button size="sm" variant="outline" onclick={retryStock}>{m.pos_post_stock_retry()}</Button>
          </div>
        {/if}
        <CustomerPicker bind:crmContactId bind:customerName required={data.posSettings.requireCustomer} />
        <div class="cart-scroll">
          <SellCart bind:lines settings={{ allowPriceOverride: data.posSettings.allowPriceOverride }} />
          <PaymentPanel {total} methods={data.posSettings.methods} bind:payments />
        </div>
        <div class="charge-bar">
          <div class="total-row">
            <span>{m.pos_sell_total()}</span>
            <span class="total">{total.toFixed(2)}</span>
          </div>
          <div class="remaining" class:done={remainingCents === 0}>
            {m.pos_sell_remaining()}: {(remainingCents / 100).toFixed(2)}
          </div>
          <Button variant="primary" size="lg" disabled={chargeDisabled} loading={submitting} onclick={charge}>{m.pos_sell_charge()}</Button>
        </div>
      </div>
    </div>

    <div class="footer">
      <h2 class="section-h">{m.pos_recent_sales()}</h2>
      {#if data.recentTickets.length === 0}
        <EmptyState title={m.common_noMatches()} compact />
      {:else}
        <div class="ticket-list">
          {#each data.recentTickets as t (t.id)}
            <div class="ticket-row">
              <span class="tid">{t.humanId ?? '—'}</span>
              <span class="ttime">{fmtTime(t.submittedAt)}</span>
              <span class="ttotal">{Number(t.total).toFixed(2)}</span>
              <span class="tcust">{t.customerName ?? '—'}</span>
              {#if t.status === 'void'}
                <Badge variant="semantic" value="error" size="sm">{m.pos_void()}</Badge>
              {:else if t.stockEntryId}
                <a href={`/stock/entries/${t.stockEntryId}`} title={m.pos_sell_view_entry()} class="stock-chip ok">✓</a>
              {:else if t.stockWarning}
                <span class="stock-chip warn" title={(t.stockWarning as { message: string }).message}>⚠</span>
              {/if}
              {#if t.status !== 'void' && canAct('pos', 'manage')}
                <button type="button" class="void-btn" onclick={() => voidTicketRow(t.id)}>{m.pos_void()}</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <button type="button" class="shifts-toggle" onclick={() => (shiftsOpen = !shiftsOpen)}>
        <ChevronDown size={14} class={shiftsOpen ? 'rot' : ''} />
        {m.pos_sell_shifts_history()}
      </button>
      {#if shiftsOpen}
        {#if data.shifts.length === 0}
          <EmptyState title={m.common_noMatches()} compact />
        {:else}
          <div class="shift-list">
            {#each data.shifts as s (s.id)}
              <div class="shift-row">
                <span class="stime">{fmtTime(s.openedAt)}</span>
                <span class="stime">{s.closedAt ? fmtTime(s.closedAt) : m.pos_sell_shift_status_open()}</span>
                {#if s.expected}
                  <div class="diffs">
                    {#each Object.keys(s.expected as Record<string, number>) as mth (mth)}
                      {@const exp = (s.expected as Record<string, number>)[mth] ?? 0}
                      {@const cnt = ((s.counted as Record<string, number> | null)?.[mth]) ?? 0}
                      {@const diff = Math.round((cnt - exp) * 100) / 100}
                      <Badge variant="semantic" value={Math.abs(diff) < 0.01 ? 'success' : 'warning'} size="sm">{mth}: {diff.toFixed(2)}</Badge>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
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
    gap: 0.6rem;
    min-width: 0;
    min-height: 0;
  }
  .catalog-head {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex-shrink: 0;
  }
  /* Mobile: the page itself scrolls — keep search/filters pinned on top. */
  @media (max-width: 1023.98px) {
    .catalog-head {
      position: sticky;
      top: -1rem; /* cancels the scroll container's p-4 */
      z-index: 5;
      background: var(--color-background);
      padding: 1rem 0 0.5rem;
      margin-top: -1rem;
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
    gap: 0.5rem;
  }
  .search-inp {
    min-height: 2.2rem;
    padding: 0.5rem 0.7rem;
    font-size: 0.88rem;
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
  }
  .view-toggle {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.1rem;
    background: var(--color-bg3);
  }
  .vt-btn {
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
  .vt-btn.on {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .chip-btn {
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--color-bg3);
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .chip-btn.on {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.6rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    padding: 0.6rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    text-align: left;
    cursor: pointer;
  }
  .card:hover {
    border-color: var(--color-accent);
  }
  .cname {
    font-size: 0.84rem;
    font-weight: 500;
  }
  .cprice {
    font-size: 0.8rem;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  /* ── Catalog table view ── */
  .ptable {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    overflow: hidden;
  }
  .trow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 9rem 5rem 4rem;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.7rem;
    border: none;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    color: var(--color-foreground);
    font-size: 0.82rem;
    text-align: left;
    cursor: pointer;
  }
  .trow:last-child {
    border-bottom: none;
  }
  .trow:not(.thead):hover {
    background: color-mix(in srgb, var(--color-accent) 7%, transparent);
  }
  .trow.thead {
    cursor: default;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .tname {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 500;
  }
  .tcode {
    font-size: 0.7rem;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .tcat {
    color: var(--color-muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 640px) {
    .trow {
      grid-template-columns: minmax(0, 1fr) 5rem 4rem;
    }
    .tcat {
      display: none;
    }
  }
  .cart-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: 0.85rem;
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
    gap: 0.75rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
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
    gap: 0.5rem;
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    background: var(--color-card);
    border-top: 1px solid var(--hairline);
    padding: 0.6rem 0.85rem 0.85rem;
    margin: 0 -0.85rem -0.85rem;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }
  .total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .total {
    font-variant-numeric: tabular-nums;
  }
  .remaining {
    font-size: 0.82rem;
    font-weight: 600;
    text-align: right;
    color: var(--color-destructive);
  }
  .remaining.done {
    color: var(--color-success, #4ade80);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    color: #f59e0b;
    font-size: 0.78rem;
  }
  .footer {
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .section-h {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .ticket-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .ticket-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: 0.8rem;
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
    color: var(--color-success, #4ade80);
  }
  .stock-chip.warn {
    color: #f59e0b;
  }
  .void-btn {
    background: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.5rem;
    font-size: 0.72rem;
    color: var(--color-destructive);
    cursor: pointer;
  }
  .shifts-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    align-self: flex-start;
    margin-top: 0.5rem;
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .shifts-toggle :global(.rot) {
    transform: rotate(180deg);
  }
  .shift-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .shift-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: 0.78rem;
  }
  .stime {
    color: var(--color-muted-foreground);
    min-width: 9rem;
  }
  .diffs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
</style>
