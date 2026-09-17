<script lang="ts">
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto, invalidate } from '$app/navigation';
  import { ShoppingCart, LayoutGrid, List, Receipt, History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    PageHeader,
    Badge,
    Button,
    EmptyState,
    Popover,
    SegmentedControl,
    iconSizes,
  } from '$lib/components/ui';
  import {
    groupBy,
    toTreeRows,
    isGroupRow,
    type GroupAxis,
    type TreeRow,
  } from '$lib/catalog/grouping';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { createHotkey } from '$lib/hotkeys';
  import { toastAsync, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import SellCart, {
    type CartLine,
    type SellCartSellable,
    lineCents,
    lineNeedsPrice,
  } from '$lib/components/pos/SellCart.svelte';
  import { type PaymentRow } from '$lib/components/pos/PaymentPanel.svelte';
  import { fitTendersToTotal, instalmentPrefillAmount } from '$lib/components/pos/checkout-money';
  import PaymentStep from '$lib/components/pos/PaymentStep.svelte';
  import ScheduleStep from '$lib/components/pos/ScheduleStep.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { registerForm } from '$lib/assistant/forms';
  import { fuzzyFind } from '$lib/assistant/fuzzy';
  import { POS_SALE_FORM } from '$lib/assistant/catalog';
  import type { PartyOption } from '$lib/components/crm/party-picker';

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
        redemptionId?: string | null;
        planId?: string | null;
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
            redemptionId: entry.redemptionId ?? null,
            planId: entry.planId ?? null,
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
          redemptionId: l.redemptionId ?? null,
          planId: l.planId ?? null,
        })),
      ),
    );
  });

  // ── Checkout step ── the step lives in the URL (`?step=pay`) so the browser
  // Back button returns to the cart; the cart itself stays in memory. The load
  // does not track `url`, so stepping never refetches the catalog.
  // `schedule` is step 3 (owner directive: a service invoice keeps going until
  // a date is set). It carries the SUBMITTED ticket in `?ticket=`, which is
  // also what makes it resumable later from /pos/accounts — the same URL.
  const step = $derived<'cart' | 'pay' | 'schedule'>(
    page.url.searchParams.get('step') === 'pay'
      ? 'pay'
      : page.url.searchParams.get('step') === 'schedule'
        ? 'schedule'
        : 'cart',
  );
  const scheduleTicketId = $derived(page.url.searchParams.get('ticket'));
  function goStep(
    next: 'cart' | 'pay' | 'schedule',
    opts: { replaceState?: boolean; ticketId?: string } = {},
  ) {
    const url = new URL(page.url);
    url.searchParams.delete('ticket');
    if (next === 'cart') url.searchParams.delete('step');
    else url.searchParams.set('step', next);
    if (next === 'schedule' && opts.ticketId) url.searchParams.set('ticket', opts.ticketId);
    void goto(`${url.pathname}${url.search}`, {
      replaceState: opts.replaceState ?? false,
      keepFocus: true,
      noScroll: true,
    });
  }
  // Landing on ?step=pay with nothing to settle (deep link, reload, or the
  // cart emptied by a completed sale) falls back to the cart step. This one
  // REPLACES: it is a correction, not a step the cashier took, so Back must
  // not bounce off an unreachable pay step. Same for a ticket-less ?step=schedule.
  $effect(() => {
    if (step === 'pay' && lines.length === 0) goStep('cart', { replaceState: true });
    if (step === 'schedule' && !scheduleTicketId) goStep('cart', { replaceState: true });
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

  // ── Grouping ── DEFAULTS TO FLAT on purpose: this is the till, and a cashier
  // mid-sale should not have to open a group to reach a product. Grouping is for
  // browsing ("what do we offer for ojeras?"), so it's opt-in and remembered.
  const GROUP_KEY = 'pos-sell-group';
  const GROUP_AXES: GroupAxis[] = ['none', 'zone', 'line', 'category'];
  function storedAxis(): GroupAxis {
    if (!browser) return 'none';
    const raw = localStorage.getItem(GROUP_KEY);
    return GROUP_AXES.includes(raw as GroupAxis) ? (raw as GroupAxis) : 'none';
  }
  // svelte-ignore state_referenced_locally -- seed once from localStorage
  let groupAxis = $state<GroupAxis>(storedAxis());
  $effect(() => {
    if (browser) localStorage.setItem(GROUP_KEY, groupAxis);
  });
  const groupItems = $derived([
    { value: 'none', label: m.catalog_group_none() },
    { value: 'zone', label: m.catalog_group_zone() },
    { value: 'line', label: m.catalog_group_line() },
    { value: 'category', label: m.catalog_group_category() },
  ]);

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
    // Never merge into a package-redeemed or instalment line: those carry a
    // fixed price and their own id, and bumping their qty would corrupt both.
    const i = lines.findIndex(
      (l) => l.sellable.productId === sellable.productId && !l.redemptionId && !l.planId,
    );
    if (i >= 0) {
      const existing = lines[i];
      existing.qty += 1;
      lines = [existing, ...lines.filter((_, idx) => idx !== i)];
    } else {
      lines = [{ sellable, qty: 1, unitPrice: sellable.unitPrice, discount: 0 }, ...lines];
    }
  }

  type Sellable = PageData['sellables'][number];
  /** What the grouped table actually renders: products AND synthetic headers. */
  type TableRow = TreeRow<Sellable>;

  /**
   * A search is an explicit "I know what I want", so results stay FLAT even when
   * a grouping axis is selected — otherwise every query would land behind a
   * collapsed header. Grouping applies to browsing only.
   */
  const effectiveAxis = $derived<GroupAxis>(search.trim() ? 'none' : groupAxis);
  const galleryGroups = $derived(groupBy(filtered, effectiveAxis));
  const tableRows = $derived(toTreeRows(filtered, effectiveAxis));
  /** Groups open by default — a cashier must never expand to reach a product. */
  const expandedGroupIds = $derived(tableRows.filter((r) => r.__group).map((r) => r.productId));

  const tableColumns = $derived<DataColumn<TableRow>[]>([
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
  let customerDocNumber = $state<string | null>(null);
  let payments = $state<PaymentRow[]>([]);

  // ── Client account (spec §3.4/§3.5) ── stored-value balance, live package
  // grants and open instalment plans for the selected customer. Fetched on
  // demand: most tickets are walk-ins with no account at all.
  type Account = {
    balance: number;
    grants: Array<{
      grant: { id: string; serviceProductId: string; sessionsTotal: number };
      sessionsRemaining: number;
      status: string;
    }>;
    plans: Array<{
      plan: {
        id: string;
        title: string;
        productId: string | null;
        currency: string;
        status: string;
      };
      remaining: number;
      /** Next unpaid `due_schedule` entry (server-derived, `pos-accounts.logic.ts`
       *  `nextDueInstalment`) — null with no schedule, or once it's all paid. */
      nextDue: { dueOn: string; amount: number } | null;
    }>;
  };
  let account = $state<Account | null>(null);
  let accountSeq = 0;
  $effect(() => {
    const id = partyId;
    const seq = ++accountSeq;
    if (!id) {
      account = null;
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/pos/accounts/party:${id}`);
        if (seq !== accountSeq) return; // a newer customer superseded this fetch
        account = res.ok ? ((await res.json()) as Account) : null;
      } catch {
        if (seq === accountSeq) account = null;
      }
    })();
  });
  // Every live package shows, not only the ones with a session already drawn:
  // the cashier needs to SEE what the client holds. `billSession` says when
  // there is nothing drawn to bill yet.
  const liveGrants = $derived((account?.grants ?? []).filter((g) => g.status === 'active'));
  // Cancelled/settled plans have nothing left to collect — same gate the
  // /pos/accounts client drawer already applies to its own plan actions.
  const openPlans = $derived((account?.plans ?? []).filter((p) => p.plan.status === 'open'));

  /**
   * Bill one session of a package.
   *
   * Preferred path: a session already DRAWN at booking time (spec §3.2) and not
   * yet billed — `ticketId === null` on the redemption is the authority for
   * that, stamped by `submitTicket` inside the money transaction. Sessions of
   * one grant are interchangeable, so the oldest unbilled one is taken.
   *
   * Fallback: a walk-in who holds sessions but has no appointment. Then the
   * counter draws one itself through `POST …/grants/:id/redeem`, which applies
   * the same exhaustion / expiry / cancellation 409s as the booking path.
   *
   * TODO(handoff): that till-side draw happens on CLICK, not on submit, so an
   * abandoned cart leaves a drawn-but-unbilled session and nothing reverses it
   * (there is no reversal endpoint). Re-opening the same grant reuses that
   * redemption rather than drawing another, so the abandon→re-ring path is
   * free; a client who simply never comes back is one session short until an
   * operator fixes it by hand. See meta
   * proposals/2026-09-13-pos-packages-plans-s1-followups.md §24.
   */
  async function billSession(grantId: string) {
    const res = await fetch(`/api/pos/packages/grants/${grantId}`);
    if (!res.ok) return toastWarning(m.pos_pkg_redeem_none());
    const detail = (await res.json()) as {
      grant: { serviceProductId: string };
      redemptions: Array<{
        id: string;
        bookingId: string | null;
        ticketId: string | null;
        redeemedAt: string;
        reversedAt: string | null;
      }>;
    };
    const sellable = data.sellables.find((sl) => sl.productId === detail.grant.serviceProductId);
    if (!sellable) return toastWarning(m.pos_pkg_redeem_no_service());
    // Unbilled = live, not already on another ticket, not already in this cart.
    let next =
      detail.redemptions
        .filter((r) => !r.reversedAt && !r.ticketId)
        .sort((a, b) => a.redeemedAt.localeCompare(b.redeemedAt))
        .find((r) => !lines.some((l) => l.redemptionId === r.id)) ?? null;
    if (!next) {
      const drawn = await fetch(`/api/pos/packages/grants/${grantId}/redeem`, { method: 'POST' });
      if (!drawn.ok) {
        const body = (await drawn.json().catch(() => null)) as { error?: string } | null;
        return toastWarning(body?.error ?? m.pos_pkg_redeem_none());
      }
      const minted = (await drawn.json()) as {
        redemption: { id: string; bookingId: string | null };
      };
      next = { ...minted.redemption, ticketId: null, redeemedAt: '', reversedAt: null };
    }
    lines = [
      {
        sellable,
        qty: 1,
        unitPrice: 0,
        discount: 0,
        bookingId: next.bookingId,
        redemptionId: next.id,
      },
      ...lines,
    ];
  }

  /**
   * An instalment toward a plan: an ordinary paid line carrying `planId`.
   *
   * TODO(handoff): the line posts `finProductId: null` (revenue-by-product does
   * not see instalment money) and its synthetic sellable is dropped by
   * `loadCart` on reload, so a half-built instalment ticket does not survive a
   * refresh. See meta
   * proposals/2026-09-13-pos-packages-plans-s1-followups.md §21.
   */
  function addInstalment(p: Account['plans'][number]) {
    if (lines.some((l) => l.planId === p.plan.id)) return;
    // The next amount actually due (schedule-aware), never the whole plan
    // balance — see checkout-money.ts `instalmentPrefillAmount`.
    const amount = instalmentPrefillAmount(p);
    const sellable: SellCartSellable = {
      // Synthetic cart key — an instalment is money against the PLAN, not a
      // sale of the treatment, so the wire `finProductId` is null (below).
      productId: `plan:${p.plan.id}`,
      code: '',
      name: p.plan.title,
      category: null,
      unitPrice: amount,
      active: true,
      kind: 'service',
      itemId: null,
      stockQty: null,
      hasMapping: false,
    };
    lines = [{ sellable, qty: 1, unitPrice: amount, discount: 0, planId: p.plan.id }, ...lines];
  }

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
              {
                sellable,
                qty: 1,
                unitPrice: sellable.unitPrice,
                discount: 0,
                bookingId: h.bookingId,
              },
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

  // Only enabled methods are offered at the register; disabling one in
  // /pos/settings removes it here without touching historical tickets.
  const paymentMethods = $derived(
    data.posSettings.methods
      .filter((mth) => mth.enabled)
      .map((mth) => ({ id: mth.id, label: mth.label, takesTendered: mth.takesTendered })),
  );

  const totalCents = $derived(lines.reduce((s, l) => s + lineCents(l), 0));
  const total = $derived(totalCents / 100);
  const paidCents = $derived(payments.reduce((s, p) => s + Math.round(p.amount * 100), 0));
  const remainingCents = $derived(totalCents - paidCents);
  const tenderOk = $derived(
    payments.every(
      (p) =>
        !p.takesTendered ||
        p.tendered == null ||
        Math.round(p.tendered * 100) >= Math.round(p.amount * 100),
    ),
  );
  const customerMissing = $derived(data.posSettings.requireCustomer && !partyId && !customerName);
  /** FACES needs a DNI/RUC per invoice; other orgs configure it off. The SERVER
   *  is the authority (`submitTicket` → `identity_document_required`, checked
   *  against the party spine) — this only stops the obvious try, exactly like
   *  `requireCustomer` above. */
  const identityRequired = $derived(data.posSettings.requirements?.identityDocument === 'required');
  const identityMissing = $derived(identityRequired && !customerDocNumber);
  /** `credit` draws on the client's stored value — the server checks the balance
   *  under a lock (409 `insufficient_credit`); this only stops the obvious try.
   *
   *  TODO(handoff): the tender only appears when the org registered a method
   *  whose id is literally `credit` in /pos/settings — there is no UI for that
   *  and no `drawsOnCredit` flag to read instead. See meta
   *  proposals/2026-09-13-pos-packages-plans-s1-followups.md §22. */
  const creditPaid = $derived(
    payments
      .filter((p) => p.method === 'credit')
      .reduce((s, p) => s + Math.round(p.amount * 100), 0),
  );
  const creditOverdrawn = $derived(
    creditPaid > 0 && creditPaid > Math.round((account?.balance ?? 0) * 100),
  );
  // Server rejects tickets without an open shift (no_open_shift) — mirror that
  // in the UI so the cashier can't even try.
  const shiftOpen = $derived(!!page.data.openShift);
  let submitting = $state(false);
  // First unmet precondition, in fix-order — shown ON the step's own button so
  // a disabled button is never silent (one blocker at a time, not a checklist).
  // Split by step: the cart step can only be blocked by cart-side problems.
  const cartBlocker = $derived.by(() => {
    if (!shiftOpen) return m.pos_no_open_shift();
    if (lines.length === 0) return m.pos_charge_blocked_empty();
    // `lineNeedsPrice`, not a bare price check: a redeemed session is
    // legitimately free, and the old bare check labelled such a ticket
    // "Set price: …" on a button that was in fact enabled.
    const unpriced = lines.find(lineNeedsPrice);
    if (unpriced) return m.pos_charge_blocked_price({ name: unpriced.sellable.name });
    if (customerMissing) return m.pos_customer_required();
    if (identityMissing) return m.pos_customer_identity_required();
    return null;
  });
  /**
   * Tenders survive a Back to the cart step, so editing the cart there can leave
   * Σ tenders ABOVE the new total. Rather than disabling Finish sale and making
   * the cashier delete rows by hand, the tenders RE-FIT to the new total:
   * last-entered first, dropped when fully absorbed (`fitTendersToTotal`, unit
   * tested in `checkout-money.test.ts`). A total that RISES is left alone — the
   * shortfall is simply "Remaining". `pos_pay_over_tendered` stays as the guard
   * for any state this does not reach.
   */
  $effect(() => {
    const target = totalCents;
    const current = untrack(() => payments);
    const fitted = fitTendersToTotal(current, target);
    if (fitted !== current) payments = fitted as PaymentRow[];
  });
  const payBlocker = $derived.by(() => {
    if (paidCents > totalCents) return m.pos_pay_over_tendered();
    if (paidCents < totalCents)
      return m.pos_charge_blocked_remaining({ amount: formatMoney(remainingCents / 100) });
    if (!tenderOk) return m.pos_charge_blocked_tender();
    if (creditOverdrawn) return m.pos_acct_insufficient_credit();
    return null;
  });
  const chargeBlocker = $derived(cartBlocker ?? payBlocker);
  const chargeDisabled = $derived(chargeBlocker != null || submitting);

  // Enter settles the ticket once it is fully tendered — fires inside the
  // amount inputs too, which is where the cashier's hands already are.
  createHotkey(
    'Enter',
    () => void charge(),
    () => ({
      enabled: step === 'pay' && !chargeDisabled,
      ignoreInputs: false,
      meta: { name: m.pos_pay_finish() },
    }),
  );

  // ── Assistant: fill the current sale (never charges) ──
  $effect(() =>
    registerForm({
      def: POS_SALE_FORM,
      get: () => ({
        customer: customerName ?? '',
        item: lines[0]?.sellable.name ?? '',
        qty: lines[0]?.qty ?? '',
        note: '',
      }),
      set: async (v) => {
        const filled: string[] = [];
        const rejected: Array<{ key: string; reason: string }> = [];
        const notes: string[] = [];
        const matched = (typed: string, label: string) => {
          if (typed.trim().toLowerCase() !== label.trim().toLowerCase())
            notes.push(`matched "${typed}" → "${label}"`);
        };
        if (typeof v.customer === 'string' && v.customer.trim()) {
          const q = v.customer.trim();
          let found: PartyOption[] = [];
          try {
            // Same endpoint CustomerPicker searches (name / DNI / phone / email).
            const res = await fetch(`/api/crm/parties?q=${encodeURIComponent(q)}&type=person`);
            if (res.ok) found = (await res.json()) as PartyOption[];
          } catch {
            /* treated as no match */
          }
          const { match: p, candidates } = fuzzyFind(q, found, (x) => [
            x.name,
            x.docNumber,
            x.phone9,
          ]);
          if (p) {
            // Exactly what CustomerPicker.pick() sets through its bindables —
            // the document included, or an identity-required org would block a
            // cart the assistant just filled from a client who HAS one on file.
            partyId = p.id;
            customerName = p.name ?? '—';
            customerPhone = p.phone9 ?? null;
            customerDocNumber = p.docNumber ?? null;
            filled.push('customer');
            matched(q, p.name ?? '');
          } else {
            rejected.push({
              key: 'customer',
              reason: `no customer matches "${q}"; did you mean: ${candidates.map((x) => x.name ?? x.docNumber ?? '—').join(', ') || 'none'}`,
            });
          }
        }
        if (typeof v.item === 'string' && v.item.trim()) {
          const { match, candidates } = fuzzyFind(v.item, data.sellables, (s) => [s.code, s.name]);
          const qty = v.qty == null || v.qty === '' ? 1 : Number(v.qty);
          if (!Number.isFinite(qty) || qty <= 0) {
            rejected.push({ key: 'qty', reason: 'qty must be a positive number' });
          } else if (match) {
            addLine(match);
            lines[0].qty += qty - 1;
            filled.push('item');
            if (v.qty != null) filled.push('qty');
            matched(v.item, match.name);
          } else {
            rejected.push({
              key: 'item',
              reason: `no item matches "${v.item}"; did you mean: ${candidates.map((s) => `${s.code} — ${s.name}`).join(', ') || 'none'}`,
            });
          }
        } else if (v.qty != null) {
          rejected.push({ key: 'qty', reason: 'qty applies with item' });
        }
        if (v.note != null) rejected.push({ key: 'note', reason: 'no note field' });
        return { filled, rejected, note: notes.join('; ') || undefined };
      },
    }),
  );

  // ── Submit ──
  let stockBanner = $state<{ ticketId: string; message: string } | null>(null);
  // Preflight refusal (409 insufficient_stock) — distinct from stockBanner
  // (a post-commit warning on an already-charged ticket). canOverride mirrors
  // the server's own gate: allowNegativeStock requires 'pos:manage', so an
  // ordinary cashier only ever sees the ask-a-manager copy.
  let shortfallBanner = $state<{ message: string; canOverride: boolean } | null>(null);

  async function charge(force = false) {
    if (chargeDisabled) return;
    submitting = true;
    shortfallBanner = null;
    try {
      const result = await toastAsync(
        (async () => {
          const res = await fetch('/api/pos/tickets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              lines: lines.map((l) => ({
                // The wire only knows service|product: a BUNDLE is sold as one
                // service line and explodes into package grants server-side.
                kind: l.sellable.kind === 'product' ? 'product' : 'service',
                // An instalment is money against the plan, not a sale of the
                // treatment — the plan itself carries the product.
                finProductId: l.planId ? null : l.sellable.productId,
                bookingId: l.bookingId ?? null,
                description: l.sellable.name,
                qty: l.qty,
                unitPrice: l.unitPrice ?? 0,
                discount: l.discount,
                planId: l.planId ?? null,
                redemptionId: l.redemptionId ?? null,
              })),
              payments: payments.map((p) => ({
                method: p.method,
                amount: p.amount,
                tendered: p.takesTendered ? (p.tendered ?? p.amount) : null,
              })),
              partyId,
              customerName,
              allowNegativeStock: force,
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) {
            const err = new Error(j?.error ?? `Failed (${res.status})`) as Error & {
              code?: string;
              items?: { itemName: string; requested: number; available: number }[];
            };
            err.code = j?.code;
            err.items = j?.items;
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
            if (code === 'insufficient_credit') return { title: m.pos_acct_insufficient_credit() };
            if (code === 'package_requires_customer')
              return { title: m.pos_pkg_requires_customer() };
            if (code === 'identity_document_required')
              return { title: m.pos_customer_identity_required() };
            if (code === 'insufficient_stock') {
              const items =
                (err as { items?: { itemName: string; requested: number; available: number }[] })
                  .items ?? [];
              const itemsText = items
                .map((it) =>
                  m.pos_stock_shortfall_item({
                    name: it.itemName,
                    requested: it.requested,
                    available: it.available,
                  }),
                )
                .join('; ');
              shortfallBanner = { message: itemsText, canOverride: canAct('pos', 'manage') };
              return { title: m.pos_stock_shortfall({ items: itemsText }) };
            }
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
      // Owner directive: a SERVICE invoice keeps going until a date is set.
      // Computed BEFORE the cart is cleared; a line that already carries a
      // booking (charged from the appointments tab, or a package session drawn
      // at booking time) is already scheduled and never re-asks.
      const needsSchedule =
        data.schedulingEnabled && lines.some((l) => l.sellable.kind !== 'product' && !l.bookingId);
      lines = [];
      payments = [];
      partyId = null;
      customerName = null;
      customerPhone = null;
      customerDocNumber = null;
      await invalidate('pos:shift');
      await invalidate('pos:sell');
      account = null;
      // REPLACES the pay step: Back from scheduling must reach the fresh cart,
      // never a settled ticket's tender screen.
      if (needsSchedule) goStep('schedule', { replaceState: true, ticketId: result.ticket.id });
    } catch {
      // toastAsync already surfaced the failure
    } finally {
      submitting = false;
    }
  }

  /** "Charge anyway" from the shortfall banner — same cart, allowNegativeStock: true. */
  function chargeAnyway() {
    void charge(true);
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
    {#snippet leading()}<ShoppingCart size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  {#if shortfallBanner}
    <!-- Step-independent: the refusal fires from the PAY step (Finish sale),
         not the cart step, so this can't live inside the cart-only markup
         below or the override action would be unreachable from where the
         error actually happens. -->
    <div class="banner shortfall-banner">
      <span>{m.pos_stock_shortfall({ items: shortfallBanner.message })}</span>
      {#if shortfallBanner.canOverride}
        <Button size="sm" variant="outline" onclick={chargeAnyway} disabled={submitting}
          >{m.pos_stock_shortfall_charge_anyway()}</Button
        >
      {:else}
        <span class="t-caption">{m.pos_stock_shortfall_ask_manager()}</span>
      {/if}
    </div>
  {/if}

  <PageBody padding="compact" scroll="region">
    {#if step === 'schedule' && scheduleTicketId}
      <ScheduleStep
        ticketId={scheduleTicketId}
        eventTypes={data.eventTypes}
        resources={data.resources}
        stockEnabled={data.stockEnabled}
        onexit={() => goStep('cart')}
      />
    {:else if step === 'pay'}
      <PaymentStep
        {lines}
        {total}
        methods={paymentMethods}
        bind:payments
        {customerName}
        creditBalance={account?.balance ?? null}
        remaining={remainingCents / 100}
        blocker={chargeBlocker}
        {submitting}
        onBack={() => goStep('cart')}
        onFinish={() => charge()}
      />
    {:else}
      <div class="layout">
        <div class="catalog">
          <div class="catalog-head">
            <div class="search-row">
              <input
                class="search-inp"
                data-assist="pos_sale.item"
                placeholder={m.pos_sell_search_placeholder()}
                bind:value={search}
                bind:this={searchEl}
              />

              <Popover placement="bottom">
                {#snippet trigger()}
                  <span class="hbtn" title={m.pos_recent_sales()}>
                    <Receipt size={iconSizes.sm} />
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
                    <History size={iconSizes.sm} />
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
                            >{s.closedAt
                              ? fmtTime(s.closedAt)
                              : m.pos_sell_shift_status_open()}</span
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
              <SegmentedControl
                class="group-seg"
                aria-label={m.catalog_group_by()}
                value={groupAxis}
                items={groupItems}
                onValueChange={(v) => (groupAxis = v as GroupAxis)}
              />
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
                  <LayoutGrid size={iconSizes.sm} />
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
                  <List size={iconSizes.sm} />
                </Button>
              </div>
            </div>
          </div>

          {#if view === 'gallery'}
            <div class="catalog-scroll">
              {#if filtered.length === 0}
                <EmptyState title={m.pos_sell_no_results()} compact />
              {:else}
                <!-- Grouped GALLERY sections rather than a collapsible tree: at the
                   till, one tap must add a product, so nothing is ever hidden
                   behind an expand. Ungrouped renders a single unlabelled group. -->
                {#each galleryGroups as g (g.key)}
                  {#if g.label}
                    <div class="grp-head">
                      <span class="grp-name">{g.label}</span>
                      <span class="grp-count"
                        >{m.catalog_group_count({ count: g.rows.length })}</span
                      >
                    </div>
                  {/if}
                  <div class="grid">
                    {#each g.rows as s (s.productId)}
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
                        {#if s.stockQty != null}
                          <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm"
                            >{s.stockQty}</Badge
                          >
                        {/if}
                      </Button>
                    {/each}
                  </div>
                {/each}
              {/if}
            </div>
          {:else}
            <!-- Shared DataTable, stripped for POS: no toolbar chrome, row click adds. -->
            <div class="table-wrap">
              <DataTable
                class="flex-1 min-h-0"
                columns={tableColumns}
                data={tableRows}
                getRowId={(s) => s.productId}
                getSubRows={(s) => s.__children}
                initialExpanded={expandedGroupIds}
                searchable={false}
                columnMenu={false}
                reorderable={false}
                resizable={false}
                onRowClick={(s) => {
                  // ★ Group headers are the SAME row type as products (DataTable's
                  // getSubRows walks one type), so without this guard clicking
                  // "Labios" would add a fictional product to the ticket.
                  if (!isGroupRow(s)) addLine(s);
                }}
                emptyMessage={m.pos_sell_no_results()}
              >
                {#snippet cell(s: TableRow, col: DataColumn<TableRow>)}
                  {#if col.key === 'name'}
                    {#if s.__group}
                      <span class="tgroup"
                        >{s.__group.label}<span class="tcount"
                          >{m.catalog_group_count({ count: s.__group.count })}</span
                        ></span
                      >
                    {:else}
                      <span class="tname">{s.name}<span class="tcode">{s.code}</span></span>
                    {/if}
                  {:else if s.__group}
                    <!-- A header has no price, stock or category of its own. -->
                    <span></span>
                  {:else if col.key === 'unitPrice'}
                    <span class="tabular-nums"
                      >{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span
                    >
                  {:else if col.key === 'stockQty'}
                    {#if s.stockQty != null}
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
          <div data-assist="pos_sale.customer">
            <CustomerPicker
              bind:partyId
              bind:customerName
              bind:phone={customerPhone}
              bind:docNumber={customerDocNumber}
              required={data.posSettings.requireCustomer}
              documentRequirement={data.posSettings.requirements?.identityDocument ?? 'off'}
            />
          </div>
          <!-- Client account: stored value the cashier can tender, sessions this
             client already paid for, and instalment plans awaiting payment. -->
          {#if account && (account.balance !== 0 || liveGrants.length || openPlans.length)}
            <div class="acct">
              <div class="acct-row">
                <span class="t-caption">{m.pos_acct_balance()}</span>
                <span class="acct-balance">{formatMoney(account.balance)}</span>
                <a class="acct-link t-caption" href="/pos/accounts">{m.pos_acct_open()}</a>
              </div>
              {#each liveGrants as g (g.grant.id)}
                <div class="acct-row">
                  <Badge variant="semantic" value="success" size="sm">
                    {m.pos_pkg_sessions({
                      remaining: String(g.sessionsRemaining),
                      total: String(g.grant.sessionsTotal),
                    })}
                  </Badge>
                  <span class="acct-name"
                    >{data.sellables.find((sl) => sl.productId === g.grant.serviceProductId)
                      ?.name ?? '—'}</span
                  >
                  <Button size="sm" variant="outline" onclick={() => billSession(g.grant.id)}>
                    {m.pos_pkg_redeem()}
                  </Button>
                </div>
              {/each}
              {#each openPlans as p (p.plan.id)}
                <div class="acct-row">
                  <Badge variant="semantic" value="info" size="sm">
                    {m.pos_plan_remaining({ value: formatMoney(p.remaining, p.plan.currency) })}
                  </Badge>
                  <span class="acct-name">{p.plan.title}</span>
                  <Button size="sm" variant="outline" onclick={() => addInstalment(p)}>
                    {m.pos_plan_pay()}
                  </Button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="cart-scroll">
            <SellCart
              bind:lines
              settings={{ allowPriceOverride: data.posSettings.allowPriceOverride }}
            />
          </div>
          <div class="charge-bar">
            <div class="total-row">
              <span>{m.pos_sell_total()}</span>
              <span class="total">{formatMoney(total)}</span>
            </div>
            <!-- Step 1 never settles the ticket: it hands a valid cart to the
               pay step, where the tenders live. -->
            <Button
              variant="primary"
              size="lg"
              disabled={cartBlocker != null}
              data-assist="pos_sale.submit"
              onclick={() => goStep('pay')}
              >{cartBlocker ?? m.pos_pay_charge_amount({ amount: formatMoney(total) })}</Button
            >
          </div>
        </div>
      </div>
    {/if}
  </PageBody>
</PageShell>

<style>
  .acct {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    padding: var(--space-2);
  }
  .acct-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .acct-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acct-balance {
    flex: 1;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .acct-link {
    color: var(--color-accent);
    text-decoration: none;
  }
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
  /* Group header inside the gallery — a quiet label, not a card. */
  .grp-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1) var(--space-1);
  }
  .grp-name {
    font-size: var(--font-size-label);
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .grp-count {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  /* Group header inside the DataTable tree. */
  .tgroup {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .tcount {
    font-size: var(--font-size-caption);
    font-weight: 400;
    color: var(--color-text-tertiary);
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
  /* Page-level (outside PageBody's own padding/gap), so it needs its own
     spacing on every side it touches. */
  .shortfall-banner {
    margin: var(--space-2, 8px) var(--space-3, 12px) 0;
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
