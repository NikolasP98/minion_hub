<script lang="ts">
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { missingRequirements, type RequirementKind } from '$lib/pos/requirements';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto, invalidate } from '$app/navigation';
  import { ShoppingCart, History, ListFilter } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, Button, EmptyState, Popover, iconSizes } from '$lib/components/ui';
  import PeekLink from '$lib/records/PeekLink.svelte';
  import {
    catalogGroupLabel,
    catalogGroupSpec,
    ZONE_LABELS,
    LINE_LABELS,
    type GroupAxis,
  } from '$lib/catalog/taxonomy';
  import { groupRows } from '$lib/components/data-table/group-by';
  import FilterAddMenu from '$lib/components/data-table/FilterAddMenu.svelte';
  import FilterChip from '$lib/components/data-table/FilterChip.svelte';
  import GroupByPicker from '$lib/components/data-table/GroupByPicker.svelte';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import { createCardFields } from '$lib/components/data-view/card-fields.svelte';
  import SellableCard from '$lib/components/pos/SellableCard.svelte';
  import CardFieldsMenu from '$lib/components/pos/CardFieldsMenu.svelte';
  import { cardFieldCatalog, stockTone } from '$lib/pos/sellable-card-fields';
  import { createViewPref } from '$lib/components/data-view/view-pref.svelte';
  import AdvancedFilterBuilder from '$lib/components/data-table/AdvancedFilterBuilder.svelte';
  import { applyFilters } from '$lib/components/data-table/apply-filters';
  import {
    emptyFilter,
    emptyRule,
    isFilterActive,
    newId,
    type FilterColumnMeta,
    type FilterGroup,
    type FilterValue,
  } from '$lib/components/data-table/filters';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { createHotkey } from '$lib/hotkeys';
  import { toastAsync, toastError, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import SellCart, {
    type CartLine,
    type SellCartSellable,
    lineNeedsPrice,
  } from '$lib/components/pos/SellCart.svelte';
  import { type PaymentRow } from '$lib/components/pos/PaymentPanel.svelte';
  import {
    cashierPaymentMethods,
    creditPayments,
    paymentPolicyIssue,
  } from '$lib/components/pos/payment-policy';
  import { submitPosTicket, type PosTicketRequest } from '$lib/components/pos/pos-ticket-transport';
  import {
    createPaymentPolicyRecovery,
    repairCommittedTicketView,
    runPaymentPolicyTicketAttempt,
  } from '$lib/components/pos/payment-policy-recovery.svelte';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import {
    cartMoneyState,
    instalmentPrefillAmount,
    moneyDraft,
    paymentRowsState,
    remainingMoneyState,
  } from '$lib/components/pos/checkout-money';
  import { createTenderRefitCoordinator } from '$lib/components/pos/tender-refit.svelte';
  import { decimalToNumber } from '$lib/money/decimal';
  import PaymentStep from '$lib/components/pos/PaymentStep.svelte';
  import PlanScheduleWarning from '$lib/components/pos/PlanScheduleWarning.svelte';
  import ScheduleStep from '$lib/components/pos/ScheduleStep.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { registerForm } from '$lib/assistant/forms';
  import { fuzzyFind } from '$lib/assistant/fuzzy';
  import { POS_SALE_FORM } from '$lib/assistant/catalog';
  import type { PartyOption } from '$lib/components/crm/party-picker';
  import {
    freezePlanCart,
    observePendingPlanOperation,
    type PendingPlanObservation,
  } from '$lib/components/pos/plan-open-persistence';
  import {
    applyPreparedSellContinuation,
    requireRestorablePendingSale,
  } from '$lib/components/pos/plan-open-sell-continuation';
  import {
    createSellSessionCoordinator,
    sellPlanInstalmentLine,
    type SellChargeClaim,
    type SellAccount,
  } from '$lib/components/pos/sell-session.svelte';

  let { data }: { data: PageData } = $props();

  // ── Cart/customer persistence ── the app layout can replace actor or org
  // without remounting this route. The coordinator owns that reactive scope,
  // all storage failures and every account-response continuation.
  let planOperationObservation = $state<PendingPlanObservation | { status: 'checking' }>({
    status: 'checking',
  });
  $effect(() => {
    const identity = {
      actorId: page.data.user.id,
      orgId: page.data.activeOrgId ?? '',
    };
    planOperationObservation = { status: 'checking' };
    if (!browser || !identity.actorId || !identity.orgId) {
      planOperationObservation = { status: 'blocked' };
      return;
    }
    return observePendingPlanOperation(identity, (observation) => {
      planOperationObservation = observation;
    });
  });
  const holdCartPersistence = $derived(
    planOperationObservation.status === 'checking' ||
      planOperationObservation.status === 'blocked' ||
      (planOperationObservation.status === 'ready' &&
        planOperationObservation.record?.continuation.kind === 'sell'),
  );
  const recoverPlanOperation = $derived(
    planOperationObservation.status === 'blocked' ||
      (planOperationObservation.status === 'ready' && planOperationObservation.record !== null),
  );
  let lines = $state<CartLine[]>([]);
  let partyId = $state<string | null>(null);
  let customerName = $state<string | null>(null);
  let customerPhone = $state<string | null>(null);
  let customerDocNumber = $state<string | null>(null);
  let payments = $state<PaymentRow[]>([]);
  let pendingPlanId = $state<string | null>(null);
  let activeHandoff = $state<SellChargeClaim | null>(null);

  function browserStorage(): Storage | null {
    if (!browser) return null;
    try {
      return localStorage;
    } catch {
      return null;
    }
  }

  const sellSession = createSellSessionCoordinator({
    identity: () => ({
      actorId: page.data.user.id,
      orgId: page.data.activeOrgId ?? '',
    }),
    sellables: () => data.sellables,
    lines: () => lines,
    replaceLines: (next) => (lines = next),
    customer: () => ({ partyId, customerName, customerPhone, customerDocNumber }),
    replaceCustomer: (next) => {
      partyId = next.partyId;
      customerName = next.customerName;
      customerPhone = next.customerPhone;
      customerDocNumber = next.customerDocNumber;
    },
    holdCartPersistence: () => holdCartPersistence,
    storage: browserStorage,
    restoreFailureMessage: m.pos_plan_cart_restore_failed,
    persistenceFailureMessage: m.pos_cart_persistence_unavailable,
    onScopeChanged: () => {
      payments = [];
      pendingPlanId = null;
      activeHandoff = null;
    },
  });
  const account = $derived(sellSession.account);
  const cartProjectionPending = $derived(sellSession.cartProjectionPending);
  const cartProjectionError = $derived(sellSession.cartProjectionError);
  const cartStorageError = $derived(sellSession.storageError);
  const paymentPolicyRecovery = createPaymentPolicyRecovery({
    owner: () => ({ actorId: page.data.user.id, orgId: page.data.activeOrgId ?? '' }),
    revision: () => data.posSettings.paymentPolicyRevision,
    reload: () => invalidate('pos:shift'),
  });
  const paymentPolicyState = $derived(paymentPolicyRecovery.state);
  const rejectedPolicyRevision = $derived(paymentPolicyRecovery.rejectedRevision);

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
    if (step === 'pay' && lines.length === 0 && !cartProjectionPending)
      goStep('cart', { replaceState: true });
    if (step === 'schedule' && !scheduleTicketId) goStep('cart', { replaceState: true });
  });

  // ── Catalog ──
  let search = $state('');
  let searchEl: HTMLInputElement | undefined = $state();

  // Recovery-critical cart storage reports its own visible error; a view
  // preference can safely remain in memory when browser storage is off.
  const viewPref = createViewPref('pos-sell-view', ['gallery', 'table'] as const, 'gallery');

  // ── Grouping ── DEFAULTS TO FLAT on purpose: this is the till, and a cashier
  // mid-sale should not have to open a group to reach a product. Grouping is for
  // browsing ("what do we offer for ojeras?"), so it's opt-in and remembered.
  const groupPref = createViewPref<GroupAxis>(
    'pos-sell-group',
    ['none', 'zone', 'line', 'category'],
    'none',
  );
  const groupAxis = $derived(groupPref.value);
  const groupByOptions = $derived([
    { value: 'zone', label: m.catalog_group_zone() },
    { value: 'line', label: m.catalog_group_line() },
    { value: 'category', label: m.catalog_group_category() },
  ]);

  createHotkey('/', () => searchEl?.focus(), { meta: { name: m.pos_sell_search_placeholder() } });

  // ── Filters (Notion-style: simple chips + an advanced rule tree) ── session
  // state only, same lifetime as the old category chip. Both the gallery and
  // the table filter through the SAME `applyFilters` pass over `data.sellables`
  // (mirrors /pos/catalog's board/table split — `catalogMatchOf`), so neither
  // view can ever disagree with the other.
  type Sellable = PageData['sellables'][number];
  const categoryOptions = $derived(
    Array.from(new Set(data.sellables.map((s) => s.category ?? 'uncategorized')))
      .sort()
      .map((c) => ({ value: c, label: c })),
  );
  const zoneOptions = Object.entries(ZONE_LABELS).map(([value, label]) => ({ value, label }));
  const lineOptions = Object.entries(LINE_LABELS).map(([value, label]) => ({ value, label }));
  const filterColumnsMeta = $derived<FilterColumnMeta[]>([
    { key: 'category', label: m.pos_sell_col_category(), kind: 'enum', options: categoryOptions },
    { key: 'zone', label: m.catalog_group_zone(), kind: 'enum', options: zoneOptions },
    { key: 'line', label: m.catalog_group_line(), kind: 'enum', options: lineOptions },
    { key: 'name', label: m.pos_sell_col_name(), kind: 'text' },
    { key: 'code', label: m.pos_sell_col_code(), kind: 'text' },
    { key: 'unitPrice', label: m.pos_sell_price(), kind: 'number' },
    { key: 'stockQty', label: m.pos_catalog_col_stock(), kind: 'number' },
  ]);
  function sellMatchOf(key: string): ((row: unknown) => unknown) | null {
    switch (key) {
      case 'category':
        return (row) => (row as Sellable).category ?? 'uncategorized';
      case 'zone':
        return (row) => (row as Sellable).taxonomy.zone;
      case 'line':
        return (row) => (row as Sellable).taxonomy.line;
      case 'name':
        return (row) => (row as Sellable).name;
      case 'code':
        return (row) => (row as Sellable).code;
      case 'unitPrice':
        return (row) => (row as Sellable).unitPrice;
      case 'stockQty':
        return (row) => (row as Sellable).stockQty;
      default:
        return null;
    }
  }

  let filters = $state<Record<string, FilterValue>>({});
  let advanced = $state<FilterGroup | null>(null);
  /** Chip keys shown even while inert (just picked from the "+ Filter" menu,
   *  operand not entered yet) — same idiom as DataTable's own chip bar. */
  let openChips = $state<string[]>([]);
  let chipOpenState = $state<Record<string, boolean>>({});
  let advancedOpen = $state(false);
  function setFilterValue(key: string, value: FilterValue | null) {
    const next = { ...filters };
    if (!value || !isFilterActive(value)) delete next[key];
    else next[key] = value;
    filters = next;
  }
  function pickFilter(key: string) {
    if (!openChips.includes(key)) openChips = [...openChips, key];
    chipOpenState = { ...chipOpenState, [key]: true };
  }
  function removeChip(key: string) {
    setFilterValue(key, null);
    openChips = openChips.filter((k) => k !== key);
    if (key in chipOpenState) {
      const next = { ...chipOpenState };
      delete next[key];
      chipOpenState = next;
    }
  }
  function openAdvanced() {
    const first = filterColumnsMeta[0];
    if (!first) return;
    advanced = { id: newId(), logic: 'and', items: [emptyRule(first.key, first.kind)] };
    advancedOpen = true;
  }
  function clearFilters() {
    filters = {};
    advanced = null;
    openChips = [];
    chipOpenState = {};
  }
  const advancedActive = $derived(!!advanced && advanced.items.length > 0);
  const anyColumnFilter = $derived(
    filterColumnsMeta.some((c) => isFilterActive(filters[c.key])) || advancedActive,
  );
  const filterChipList = $derived(
    filterColumnsMeta.filter((c) => isFilterActive(filters[c.key]) || openChips.includes(c.key)),
  );
  const chipBarShown = $derived(filterChipList.length > 0 || advancedActive);

  const searched = $derived(
    data.sellables.filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
    }),
  );
  const filtered = $derived(applyFilters(searched, filters, advanced, sellMatchOf));

  const stockBadgeValue = stockTone;

  // ── Gallery card fields (per viewer, owner ask 2026-10-15): which rows a
  // card shows and in what order; every card in a band spans the same rows
  // through the grid's subgrid, so prices sit under prices across cards. ──
  const GALLERY_FIELDS = ['price', 'stock', 'kind', 'code', 'category', 'zone', 'line'] as const;
  const cardFields = createCardFields('pos-sell-gallery', GALLERY_FIELDS, [
    'code',
    'category',
    'zone',
    'line',
  ]);
  const cardFieldItems = $derived(cardFieldCatalog(GALLERY_FIELDS));
  const cardVisible = $derived(cardFields.visible as (typeof GALLERY_FIELDS)[number][]);

  // Newest (or just-bumped) line always surfaces at the top of the cart.
  function addLine(sellable: PageData['sellables'][number]) {
    // Never merge into a package-redeemed or instalment line: those carry a
    // fixed price and their own id, and bumping their qty would corrupt both.
    const i = lines.findIndex(
      (l) =>
        l.sellable.productId === sellable.productId && !l.redemptionId && !l.planId && !l.bookingId,
    );
    if (i >= 0) {
      const existing = lines[i];
      try {
        existing.qty = String(Math.max(1, Math.round(decimalToNumber(existing.qty)) + 1));
      } catch {
        // Preserve an invalid draft until the cashier corrects it.
      }
      lines = [existing, ...lines.filter((_, idx) => idx !== i)];
    } else {
      lines = [{ sellable, qty: 1, unitPrice: sellable.unitPrice, discount: 0 }, ...lines];
    }
  }

  /**
   * A search is an explicit "I know what I want", so results stay FLAT even when
   * a grouping axis is selected — otherwise every query would land behind a
   * collapsed header. Grouping applies to browsing only.
   */
  const effectiveAxis = $derived<GroupAxis>(search.trim() ? 'none' : groupAxis);
  /** Axis → the shared `groupBy` spec; `none` = no grouping at all. The table
   *  synthesizes its own header rows from this (they are NOT rows of type
   *  Sellable any more, so nothing can click one into the cart); the gallery
   *  buckets with the same spec so both views always agree. */
  const groupSpec = $derived(
    effectiveAxis === 'none' ? undefined : catalogGroupSpec<Sellable>(effectiveAxis),
  );
  const galleryGroups = $derived(
    groupSpec ? groupRows(filtered, groupSpec) : [{ key: 'all', label: '', rows: filtered }],
  );

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

  // ── Customer + payments ── the selected client persists a refresh exactly
  // like the cart lines do (same per-org localStorage idiom); it was plain
  // in-memory state before, so F5 kept the cart and lost the client.
  // ── Client account (spec §3.4/§3.5) ── stored-value balance, live package
  // grants and open instalment plans for the selected customer. Fetched on
  // demand: most tickets are walk-ins with no account at all.
  // A plan to charge as soon as the account view holds it: set by the booking
  // handoff (the treatment already has a plan → an instalment, not the full
  // price) and by the pay step right after opening a plan for this cart.
  $effect(() => {
    const id = pendingPlanId;
    if (!id || !account) return;
    const p = account.plans.find((x) => x.plan.id === id && x.plan.status === 'open');
    if (!p) return;
    untrack(() => {
      addInstalment(p);
    });
    pendingPlanId = null;
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

  function addInstalment(p: SellAccount['plans'][number]) {
    if (lines.some((l) => l.planId === p.plan.id)) return;
    // TODO(handoff): this synthetic line posts `finProductId: null`, so
    // revenue-by-product does not see instalment money. See meta proposals/
    // 2026-09-13-pos-packages-plans-s1-followups.md §21.
    const line = sellPlanInstalmentLine(p);
    if (!line) {
      toastWarning(m.pos_plan_no_amount_due());
      return;
    }
    lines = [line, ...lines];
  }

  // ── Booking → charge handoff ── wait for current actor/org hydration and
  // durable plan recovery before replacing the register draft. The handoff is
  // acknowledged only after its cart/customer bytes pass current-scope
  // readback; an old org-only key is never claimed by a different cashier.
  $effect(() => {
    const scope = sellSession.scope;
    const hydrated = sellSession.hydrated;
    const held = holdCartPersistence;
    const currentClaim = activeHandoff;
    if (!browser || !hydrated || held || currentClaim) return;
    untrack(() => {
      const result = sellSession.stageChargeHandoff(scope);
      if (result.status === 'legacy' || result.status === 'invalid') {
        toastWarning(m.pos_booking_handoff_reopen());
        return;
      }
      if (result.status !== 'staged') return;
      if (!sellSession.adoptChargeHandoff(result.claim)) return;
      activeHandoff = result.claim;
      // A calendar charge is that appointment's ticket. It replaces any
      // half-built walk-in cart rather than merging the two customers' lines.
      lines = result.claim.stage.lines;
      payments = [];
      pendingPlanId = result.claim.stage.pendingPlanId;
      partyId = result.claim.stage.customer.partyId;
      customerName = result.claim.stage.customer.customerName;
      customerPhone = result.claim.stage.customer.customerPhone;
      customerDocNumber = result.claim.stage.customer.customerDocNumber;
    });
  });

  $effect(() => {
    const claim = activeHandoff;
    const held = holdCartPersistence;
    const currentLines = lines;
    const currentCustomer = { partyId, customerName, customerPhone, customerDocNumber };
    if (!claim || held) return;
    untrack(() => {
      const result = sellSession.finalizeChargeHandoff(claim, currentLines, currentCustomer);
      if (result === 'changed' || result === 'stale') {
        activeHandoff = null;
        return;
      }
      if (result !== 'committed') return;
      activeHandoff = null;
      if (claim.stage.notice === 'loaded') toastSuccess(m.pos_booking_loaded());
      else if (claim.stage.notice === 'partial')
        toastWarning(m.pos_booking_lines_missing({ count: String(claim.stage.missingLines) }));
      else toastWarning(m.pos_booking_product_missing());
    });
  });

  function retryCartProjection(): void {
    const currentPartyId = partyId;
    if (currentPartyId) void sellSession.refreshAccount(currentPartyId);
  }

  // Only enabled methods are offered at the register; disabling one in
  // /pos/settings removes it here without touching historical tickets.
  const paymentMethods = $derived(cashierPaymentMethods(data.posSettings.methods));
  const tenderPolicyIssue = $derived(paymentPolicyIssue(payments, data.posSettings.methods));

  const cartMoney = $derived(cartMoneyState(lines));
  const paymentMoney = $derived(paymentRowsState(payments));
  const totalMinor = $derived(cartMoney.ok ? cartMoney.value.totalMinor : 0n);
  const total = $derived(cartMoney.ok ? cartMoney.value.total : 0);
  const paidMinor = $derived(paymentMoney.ok ? paymentMoney.value.paidMinor : 0n);
  const remainingMoney = $derived(
    cartMoney.ok && paymentMoney.ok
      ? remainingMoneyState(cartMoney.value.totalMinor, paymentMoney.value.paidMinor)
      : null,
  );
  const remaining = $derived(remainingMoney?.ok ? remainingMoney.value.number : null);
  const customerMissing = $derived(data.posSettings.requireCustomer && !partyId && !customerName);
  /** FACES needs a DNI/RUC per invoice; other orgs configure it off. The SERVER
   *  is the authority (`submitTicket` → `identity_document_required`, checked
   *  against the party spine) — this only stops the obvious try, exactly like
   *  `requireCustomer` above. */
  const missingReqs = $derived(
    missingRequirements(data.posSettings.requirements, {
      docNumber: customerDocNumber,
      phone: customerPhone,
    }),
  );
  const requirementShort: Record<RequirementKind, () => string> = {
    identityDocument: m.pos_customer_identity_required_short,
    phone: m.pos_customer_phone_required_short,
  };
  /** The server remains the balance authority under the canonical wallet lock;
   *  this mirrors every explicit stored-value method without inferring by id. */
  const creditMoney = $derived(
    paymentRowsState(creditPayments(payments, data.posSettings.methods)),
  );
  const balanceMoney = $derived(moneyDraft(account?.balance ?? 0, { exact: true }));
  const creditOverdrawn = $derived(
    creditMoney.ok &&
      balanceMoney.ok &&
      creditMoney.value.paidMinor > 0n &&
      creditMoney.value.paidMinor > balanceMoney.value.minor,
  );
  // Server rejects tickets without an open shift (no_open_shift) — mirror that
  // in the UI so the cashier can't even try.
  const shiftOpen = $derived(!!page.data.openShift);
  const submitting = $derived(paymentPolicyRecovery.submitting);
  // First unmet precondition, in fix-order — shown ON the step's own button so
  // a disabled button is never silent (one blocker at a time, not a checklist).
  // Split by step: the cart step can only be blocked by cart-side problems.
  const cartBlocker = $derived.by(() => {
    if (!shiftOpen) return m.pos_no_open_shift();
    if (cartStorageError) return cartStorageError;
    if (cartProjectionError) return cartProjectionError;
    if (cartProjectionPending) return m.pos_plan_cart_restoring();
    if (lines.length === 0) return m.pos_charge_blocked_empty();
    // `lineNeedsPrice`, not a bare price check: a redeemed session is
    // legitimately free, and the old bare check labelled such a ticket
    // "Set price: …" on a button that was in fact enabled.
    const unpriced = lines.find(lineNeedsPrice);
    if (unpriced) return m.pos_charge_blocked_price({ name: unpriced.sellable.name });
    if (!cartMoney.ok) {
      if (cartMoney.code === 'invalid_qty') return m.pos_money_invalid_qty();
      if (cartMoney.code === 'invalid_discount') return m.pos_money_invalid_discount();
      return m.pos_money_invalid_price();
    }
    if (customerMissing) return m.pos_customer_required();
    // Button-sized blocker: the full sentence already sits under the picker
    // (CustomerPicker's note); on the button it overflowed the control.
    if (missingReqs.length) return requirementShort[missingReqs[0]]();
    return null;
  });
  /**
   * Tenders survive a Back to the cart step, so editing the cart there can leave
   * Σ tenders ABOVE the new total. Rather than disabling Finish sale and making
   * the cashier delete rows by hand, the tenders RE-FIT to the new total:
   * last-entered first, dropped when fully absorbed (the shared tender refit
   * coordinator is mounted in `checkout-money.mounted.test.ts`). A total that RISES is left alone — the
   * shortfall is simply "Remaining". `pos_pay_over_tendered` stays as the guard
   * for any state this does not reach.
   */
  createTenderRefitCoordinator<PaymentRow>({
    targetMinor: () => (cartMoney.ok ? cartMoney.value.totalMinor : null),
    payments: () => payments,
    replace: (fitted) => (payments = fitted as PaymentRow[]),
  });
  const payBlocker = $derived.by(() => {
    if (paymentPolicyRecovery.blocksFinish)
      return paymentPolicyState === 'loading'
        ? m.pos_payment_policy_refreshing()
        : m.pos_payment_policy_reload_failed();
    if (tenderPolicyIssue === 'credit_decision_required')
      return m.pos_pay_method_configuration_required();
    if (tenderPolicyIssue === 'method_unavailable') return m.pos_pay_method_unavailable();
    if (!paymentMoney.ok)
      return paymentMoney.code === 'invalid_tender'
        ? m.pos_money_invalid_tender()
        : m.pos_money_invalid_amount();
    if (cartMoney.ok && !remainingMoney?.ok) return m.pos_money_invalid_remaining();
    if (paidMinor > totalMinor) return m.pos_pay_over_tendered();
    if (paidMinor < totalMinor)
      return m.pos_charge_blocked_remaining({
        amount: formatMoney(remainingMoney?.ok ? remainingMoney.value.number : 0),
      });
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
          let qty: number | null = null;
          try {
            qty = v.qty == null || v.qty === '' ? 1 : decimalToNumber(String(v.qty));
          } catch {
            qty = null;
          }
          if (qty == null || qty <= 0) {
            rejected.push({ key: 'qty', reason: 'qty must be a positive number' });
          } else if (match) {
            addLine(match);
            lines[0].qty = qty;
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

  function reportTicketFailure(failure: unknown): void {
    const code = (failure as { code?: string } | undefined)?.code;
    if (code === 'no_open_shift') return toastError(m.pos_no_open_shift());
    if (code === 'insufficient_credit') return toastError(m.pos_acct_insufficient_credit());
    if (code === 'package_requires_customer') return toastError(m.pos_pkg_requires_customer());
    if (code === 'identity_document_required')
      return toastError(m.pos_customer_identity_required());
    if (code === 'phone_required') return toastError(m.pos_customer_phone_required());
    if (code === 'insufficient_stock') {
      const items =
        (failure as { items?: { itemName: string; requested: number; available: number }[] })
          .items ?? [];
      const itemsText = items
        .map((item) =>
          m.pos_stock_shortfall_item({
            name: item.itemName,
            requested: item.requested,
            available: item.available,
          }),
        )
        .join('; ');
      shortfallBanner = { message: itemsText, canOverride: canAct('pos', 'manage') };
      return toastError(m.pos_stock_shortfall({ items: itemsText }));
    }
    toastError(m.pos_sell_charge(), failure instanceof Error ? failure.message : String(failure));
  }

  async function charge(force = false) {
    // TODO(handoff): HS-011 in minion-meta/proposals/2026-10-02-hub-gateway-production-readiness-recon.md
    // must add a durable ticket idempotency key and freeze the submitted draft.
    // This owner fence prevents stale UI effects but cannot reconcile a lost
    // post-commit HTTP response, so that write must still never be replayed.
    if (chargeDisabled) return;
    const checkedCart = cartMoneyState(lines);
    const checkedPayments = paymentRowsState(payments);
    if (!checkedCart.ok || !checkedPayments.ok) return;
    const checkedRemaining = remainingMoneyState(
      checkedCart.value.totalMinor,
      checkedPayments.value.paidMinor,
    );
    if (!checkedRemaining.ok || checkedRemaining.value.minor !== 0n) return;
    shortfallBanner = null;
    const paymentPolicyRevision = data.posSettings.paymentPolicyRevision;
    const attempt = await runPaymentPolicyTicketAttempt({
      recovery: paymentPolicyRecovery,
      paymentPolicyRevision,
      submit: () =>
        submitPosTicket({
          paymentPolicyRevision,
          request: {
            lines: lines.map((line, index) => ({
              // The wire only knows service|product: a BUNDLE is sold as one
              // service line and explodes into package grants server-side.
              kind: line.sellable.kind === 'product' ? 'product' : 'service',
              // An instalment is money against the plan, not a sale of the
              // treatment — the plan itself carries the product.
              finProductId: line.planId ? null : line.sellable.productId,
              bookingId: line.bookingId ?? null,
              description: line.sellable.name,
              qty: checkedCart.value.lines[index].qty,
              unitPrice: checkedCart.value.lines[index].unitPrice,
              discount: checkedCart.value.lines[index].discount,
              planId: line.planId ?? null,
              redemptionId: line.redemptionId ?? null,
            })),
            payments: payments.map((payment, index) => ({
              method: payment.method,
              amount: checkedPayments.value.rows[index].amount,
              tendered: payment.takesTendered ? checkedPayments.value.rows[index].tendered : null,
            })),
            partyId,
            customerName,
            allowNegativeStock: force,
          } satisfies PosTicketRequest,
        }),
    });
    if (attempt.status === 'committed-stale' || attempt.status === 'rejected-stale') return;
    if (attempt.status === 'policy-changed') {
      toastWarning(m.pos_payment_policy_changed());
      return;
    }
    if (attempt.status === 'rejected') {
      reportTicketFailure(attempt.error);
      return;
    }
    const result = attempt.value;
    const successTitle = m.pos_sell_success({ humanId: result.ticket.humanId ?? '—' });
    if (result.stockWarning) {
      toastWarning(successTitle, m.pos_stock_warning({ message: result.stockWarning.message }));
    } else {
      toastSuccess(successTitle);
    }
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
    await repairCommittedTicketView({
      owner: attempt.owner,
      refreshes: [
        () =>
          checkedRefresh(
            () => invalidate('pos:shift'),
            () => page,
          ),
        () =>
          checkedRefresh(
            () => invalidate('pos:sell'),
            () => page,
          ),
      ],
      onCommittedRefreshFailure: () => toastWarning(m.pos_sale_created_refresh_failed()),
      onReady: () => {
        // REPLACES the pay step: Back from scheduling must reach the fresh cart,
        // never a settled ticket's tender screen.
        if (needsSchedule) goStep('schedule', { replaceState: true, ticketId: result.ticket.id });
      },
    });
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
    const res = await fetch(`/api/pos/tickets/${id}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refund: 'cash' }),
    });
    if (res.ok) {
      await invalidate('pos:sell');
      await invalidate('pos:shift');
    }
  }

  function fmtTime(d: string | Date): string {
    return new Date(d).toLocaleString(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ── Unified "today's activity" popover (owner ask: one dropdown, not two) ──
  // Tickets + shift open/close events for the org's calendar day, newest first.
  type TodayActivity =
    | { kind: 'ticket'; at: Date; ticket: PageData['todayTickets'][number] }
    | { kind: 'shift-opened'; at: Date; shift: PageData['todayShifts'][number] }
    | { kind: 'shift-closed'; at: Date; shift: PageData['todayShifts'][number] };

  const todayActivity = $derived<TodayActivity[]>(
    [
      ...data.todayTickets.map((ticket): TodayActivity => ({
        kind: 'ticket',
        at: new Date(ticket.submittedAt),
        ticket,
      })),
      ...data.todayShifts.map((shift): TodayActivity => ({
        kind: 'shift-opened',
        at: new Date(shift.openedAt),
        shift,
      })),
      ...data.todayShifts
        .filter((shift) => shift.closedAt)
        .map((shift): TodayActivity => ({
          kind: 'shift-closed',
          at: new Date(shift.closedAt as string | Date),
          shift,
        })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()),
  );
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
        <Button
          size="sm"
          variant="outline"
          onclick={chargeAnyway}
          disabled={submitting}
          loading={submitting}>{m.pos_stock_shortfall_charge_anyway()}</Button
        >
      {:else}
        <span class="t-caption">{m.pos_stock_shortfall_ask_manager()}</span>
      {/if}
    </div>
  {/if}

  <PageBody padding="compact" scroll="region">
    {#if cartStorageError}
      <div class="banner storage-banner" role="alert">{cartStorageError}</div>
    {/if}
    {#if paymentPolicyState !== 'idle'}
      <div
        class="banner policy-banner"
        role={paymentPolicyState === 'loading' ? 'status' : 'alert'}
      >
        <span>
          {paymentPolicyState === 'loading'
            ? m.pos_payment_policy_refreshing()
            : paymentPolicyState === 'failed'
              ? m.pos_payment_policy_reload_failed()
              : m.pos_payment_policy_review_required()}
        </span>
        {#if paymentPolicyState === 'failed' && rejectedPolicyRevision}
          <Button size="xs" variant="outline" onclick={() => paymentPolicyRecovery.retry()}>
            {m.common_retry()}
          </Button>
        {/if}
      </div>
    {/if}
    {#if sellSession.hydrated && cartProjectionError}
      <div class="banner projection-banner" role="alert">
        <span>{cartProjectionError}</span>
        {#if partyId}
          <Button size="xs" variant="outline" onclick={retryCartProjection}>
            {m.common_retry()}
          </Button>
        {/if}
      </div>
    {:else if sellSession.hydrated && cartProjectionPending}
      <div class="banner projection-banner" role="status">
        <span>{m.pos_plan_cart_restoring()}</span>
      </div>
    {/if}
    {#if step === 'schedule' && scheduleTicketId}
      <ScheduleStep
        ticketId={scheduleTicketId}
        eventTypes={data.eventTypes}
        resources={data.resources}
        stockEnabled={data.stockEnabled}
        timeZone={data.orgTz}
        mutationScope={`pos:${page.data.activeOrgId ?? 'unknown'}`}
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
        {remaining}
        blocker={chargeBlocker}
        {submitting}
        {partyId}
        bookingId={lines.find((l) => l.bookingId)?.bookingId ?? null}
        planTitle={lines[0]?.sellable.name ?? ''}
        planAllowed={lines.length > 0 && !lines.some((l) => l.planId || l.redemptionId)}
        mutationScope={page.data.activeOrgId ? `pos:${page.data.activeOrgId}` : ''}
        actorId={page.data.user.id}
        orgId={page.data.activeOrgId ?? ''}
        recoverPlan={recoverPlanOperation}
        onBack={() => goStep('cart')}
        onFinish={() => charge()}
        onPlanCreated={async (plan, owner) => {
          if (!owner.isCurrent()) return;
          const planPartyId = partyId;
          if (!planPartyId) throw new Error('plan customer is unavailable');
          const sellOwner = sellSession.capture(planPartyId);
          const refreshed = await sellSession.refreshAccount(planPartyId);
          if (!owner.isCurrent()) return;
          if (!sellSession.isCurrent(sellOwner)) {
            throw new Error('sell session changed during plan recovery');
          }
          if (!refreshed) throw new Error('plan account projection did not refresh');
          const detail = refreshed.plans.find(
            (candidate) => candidate.plan.id === plan.id && candidate.plan.status === 'open',
          );
          const postLine = detail ? sellPlanInstalmentLine(detail) : null;
          if (!postLine) throw new Error('plan instalment projection is unavailable');
          const prepared = await owner.prepareSellContinuation(freezePlanCart([postLine]));
          if (!owner.isCurrent()) return;
          if (!sellSession.isCurrent(sellOwner)) {
            throw new Error('sell session changed during plan recovery');
          }
          if (owner.allowCartReplace) {
            requireRestorablePendingSale({
              rows: prepared.preCart,
              sellables: data.sellables,
              expectedPartyId: planPartyId,
              projection: refreshed,
            });
          }
          const storage = sellSession.storageFor(sellOwner);
          if (!storage) throw new Error('sell cart storage is unavailable');
          applyPreparedSellContinuation({
            prepared,
            postLines: [postLine],
            currentLines: () => lines,
            replaceLines: (next) => (lines = next),
            storage,
            storageKey: sellOwner.storageKey,
            allowReplace: owner.allowCartReplace,
          });
          payments = [];
          toastSuccess(m.pos_pay_plan_opened());
        }}
      />
    {:else}
      <div class="layout">
        <div class="catalog">
          <DataView views={['gallery', 'table']} value={viewPref.value} onchange={viewPref.set}>
            {#snippet children({ switcher, view })}
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
                      <span class="hbtn" title={m.pos_sell_activity_title()}>
                        <History size={iconSizes.sm} />
                        <span class="hbtn-label">{m.pos_sell_activity_title()}</span>
                      </span>
                    {/snippet}
                    <div class="hpanel">
                      <h2 class="section-h">{m.pos_sell_activity_title()}</h2>
                      {#if todayActivity.length === 0}
                        <EmptyState title={m.pos_sell_activity_empty()} compact />
                      {:else}
                        <div class="activity-list">
                          {#each todayActivity as a (`${a.kind}:${a.kind === 'ticket' ? a.ticket.id : a.shift.id}`)}
                            <div class="activity-row">
                              <span class="atime">{fmtTime(a.at)}</span>
                              {#if a.kind === 'ticket'}
                                <Badge variant="semantic" value="info" size="sm"
                                  >{m.pos_sell_activity_kind_sale()}</Badge
                                >
                                <PeekLink
                                  class="amain"
                                  href={`/pos/tickets/${a.ticket.id}`}
                                  mode="modal"
                                >
                                  {a.ticket.humanId ?? '—'} · {a.ticket.customerName ??
                                    m.pos_pay_walk_in()}
                                </PeekLink>
                                <span class="aamount">{formatMoney(a.ticket.total)}</span>
                                {#each a.ticket.payments as p (p.method)}
                                  <span class="apay">
                                    <PeekLink
                                      href={`/pos/tickets/${a.ticket.id}`}
                                      mode="modal"
                                      title={m.pos_tender_change()}>{p.method}</PeekLink
                                    >
                                  </span>
                                {/each}
                                {#if a.ticket.status === 'void'}
                                  <Badge variant="semantic" value="error" size="sm"
                                    >{m.pos_voided()}</Badge
                                  >
                                {:else if a.ticket.stockEntryId}
                                  <a
                                    href={`/stock/entries/${a.ticket.stockEntryId}`}
                                    title={m.pos_sell_view_entry()}
                                    class="stock-chip ok">✓</a
                                  >
                                {:else if a.ticket.stockWarning}
                                  <span
                                    class="stock-chip warn"
                                    title={(a.ticket.stockWarning as { message: string }).message}
                                    >⚠</span
                                  >
                                {/if}
                                {#if a.ticket.status !== 'void' && canAct('pos', 'manage')}
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    type="button"
                                    class="void-btn"
                                    onclick={() => voidTicketRow(a.ticket.id)}
                                    >{m.pos_void()}</Button
                                  >
                                {/if}
                              {:else}
                                <Badge variant="neutral" size="sm"
                                  >{m.pos_sell_activity_kind_shift()}</Badge
                                >
                                <span class="amain"
                                  >{a.kind === 'shift-opened'
                                    ? m.pos_sell_activity_shift_opened()
                                    : m.pos_sell_activity_shift_closed()}{#if a.shift.openedByName}
                                    · {a.shift.openedByName}{/if}</span
                                >
                                <span class="aamount">—</span>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                      <a class="activity-more" href="/pos/history"
                        >{m.pos_sell_activity_view_all()}</a
                      >
                    </div>
                  </Popover>
                </div>
                <div class="chips-row">
                  <div class="dt-view-tools">
                    <FilterAddMenu
                      columns={filterColumnsMeta}
                      onPick={pickFilter}
                      onAdvanced={openAdvanced}
                      active={anyColumnFilter}
                    />
                    <GroupByPicker
                      options={groupByOptions}
                      value={groupAxis === 'none' ? '' : groupAxis}
                      noneLabel={m.catalog_group_none()}
                      onChange={(v) => groupPref.set((v || 'none') as GroupAxis)}
                    />
                    {#if view === 'gallery'}
                      <CardFieldsMenu fields={cardFieldItems} pref={cardFields} />
                    {/if}
                  </div>
                  {@render switcher()}
                </div>
                {#if chipBarShown}
                  <div class="dt-chips">
                    {#each filterChipList as col (col.key)}
                      <FilterChip
                        label={col.label}
                        kind={col.kind}
                        options={col.options ?? []}
                        value={filters[col.key] ?? emptyFilter(col.kind)}
                        onValue={(v) => setFilterValue(col.key, v)}
                        onRemove={() => removeChip(col.key)}
                        open={chipOpenState[col.key] ?? false}
                      />
                    {/each}
                    {#if advanced && advancedActive}
                      {@const advGroup = advanced}
                      <div class="dt-adv-chip">
                        <Popover bind:open={advancedOpen} placement="bottom">
                          {#snippet trigger()}
                            <span class="dt-adv-trigger">
                              <ListFilter size={iconSizes.xs} />
                              <span
                                >{advGroup.items.length === 1
                                  ? m.data_table_filter_rule_one()
                                  : m.data_table_filter_rules({ n: advGroup.items.length })}</span
                              >
                            </span>
                          {/snippet}
                          <AdvancedFilterBuilder
                            group={advGroup}
                            columns={filterColumnsMeta}
                            onChange={(next) => (advanced = next)}
                            onDelete={() => {
                              advanced = null;
                              advancedOpen = false;
                            }}
                          />
                        </Popover>
                      </div>
                    {/if}
                    {#if filterChipList.length > 0 || advancedActive}
                      <Button
                        variant="ghost"
                        size="xs"
                        class="dt-chip-clear"
                        onclick={clearFilters}
                      >
                        {m.data_table_filters_clear_all()}
                      </Button>
                    {/if}
                  </div>
                {/if}
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
                      <!-- Each card spans title + one row per visible field; the span
                       count is declared ONCE here and drives the subgrid in CSS. -->
                      <div class="grid" style="--sc-rows: {1 + cardVisible.length}">
                        {#each g.rows as s (s.productId)}
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            class="card"
                            onclick={() => addLine(s)}
                          >
                            <SellableCard row={s} fields={cardVisible} />
                          </Button>
                        {/each}
                      </div>
                    {/each}
                  {/if}
                </div>
              {:else}
                <!-- Shared DataTable, stripped for POS: no toolbar chrome, row click adds. -->
                <div class="table-wrap">
                  {#snippet nameCell(s: Sellable)}
                    <span class="tname">{s.name}<span class="tcode">{s.code}</span></span>
                  {/snippet}
                  {#snippet priceCell(s: Sellable)}
                    <span class="tabular-nums"
                      >{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span
                    >
                  {/snippet}
                  {#snippet stockCell(s: Sellable)}
                    {#if s.stockQty != null}
                      <Badge variant="semantic" value={stockBadgeValue(s.stockQty)} size="sm"
                        >{s.stockQty}</Badge
                      >
                    {:else}
                      —
                    {/if}
                  {/snippet}
                  {#snippet groupRow(key: string, rows: Sellable[])}
                    <span class="tgroup"
                      >{effectiveAxis === 'none' ? key : catalogGroupLabel(effectiveAxis, key)}<span
                        class="tcount">{m.catalog_group_count({ count: rows.length })}</span
                      ></span
                    >
                  {/snippet}
                  <DataTable
                    class="flex-1 min-h-0"
                    columns={tableColumns}
                    data={filtered}
                    getRowId={(s) => s.productId}
                    groupBy={groupSpec}
                    chrome={false}
                    resizable={false}
                    onRowClick={addLine}
                    emptyMessage={m.pos_sell_no_results()}
                    cells={{ name: nameCell, unitPrice: priceCell, stockQty: stockCell }}
                    {groupRow}
                  />
                </div>
              {/if}
            {/snippet}
          </DataView>
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
              requirements={data.posSettings.requirements}
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
                {@const prefill = instalmentPrefillAmount(p)}
                <div class="acct-row">
                  <Badge variant="semantic" value="info" size="sm">
                    {m.pos_plan_remaining({ value: formatMoney(p.remaining, p.plan.currency) })}
                  </Badge>
                  <span class="acct-name">{p.plan.title}</span>
                  <PlanScheduleWarning issue={p.scheduleIssue} />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={prefill == null}
                    onclick={() => addInstalment(p)}
                  >
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
              <span class="total">{cartMoney.ok ? formatMoney(total) : '—'}</span>
            </div>
            <!-- Step 1 never settles the ticket: it hands a valid cart to the
               pay step, where the tenders live. -->
            <Button
              variant="primary"
              size="lg"
              class="charge-btn"
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
  /* Blocker text lives ON the charge button; long ones ("Set price: <name>")
     must wrap inside it, not spill past its edges (Button slot trap: the inner
     row span carries nowrap + a fixed control height). */
  .charge-bar :global(.charge-btn) {
    height: auto;
    min-height: var(--control-height-lg);
    white-space: normal;
  }
  .charge-bar :global(.charge-btn > span) {
    white-space: normal;
    text-align: center;
    min-width: 0;
  }
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
    flex-wrap: wrap;
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
    /* The mobile sticky header below only has to beat this pane's own table
       header and charge bar. `isolate` keeps that contest inside the pane, so
       the number it uses can never compete with app chrome (it used to claim
       `--layer-popover`, which outranked the sidebar and every menu). */
    isolation: isolate;
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
         charge bar, or they paint over the open panel. Local to `.catalog`'s
         isolated context (see above), so being above the table's sticky band
         here costs the rest of the app nothing. */
      z-index: var(--layer-navigation);
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
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
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
  /* Today's activity button — the unified popover trigger. */
  .hbtn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    height: var(--control-height-sm);
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
    height: var(--control-height-sm);
    padding: 0 var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    grid-auto-rows: auto;
    gap: var(--space-2, 8px);
  }
  /* Same card recipe as `BoardView`'s `.bcard` so gallery and board cards match. */
  :global(.pos-sell-surface .card) {
    height: auto;
    align-items: stretch;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    text-align: left;
  }
  /* The card is a SUBGRID of the gallery's rows: it spans title + N field
     rows (`--sc-rows`, declared once on `.grid`), so every card in a band
     lines its price under the neighbour's price and its content sits at the
     top (owner 2026-10-15: "use subgrids or similar, align their content to
     top"). The Button's inner row span steps aside with `display: contents`
     so the card body's rows become the grid items. */
  :global(.pos-sell-surface .grid .card) {
    display: grid;
    /* ONE full-width column: the Button primitive's `justify-content: center`
       would otherwise shrink the auto track to its content and float it
       mid-card, and its `align-items: center` would float a one-line name
       mid-row next to a two-line neighbour (shipped 2026-10-15). */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: subgrid;
    grid-row: span var(--sc-rows, 1);
    align-content: start;
    align-items: start;
    justify-content: stretch;
    justify-items: start;
    text-align: left;
    row-gap: var(--space-1, 4px);
    min-width: 0;
  }
  :global(.pos-sell-surface .card > span) {
    display: contents;
  }
  :global(.pos-sell-surface .card:hover) {
    border-color: var(--color-accent);
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
  .projection-banner,
  .policy-banner {
    flex-wrap: wrap;
  }
  .projection-banner > span,
  .policy-banner > span {
    min-width: 0;
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .projection-banner :global(button),
    .policy-banner :global(button) {
      min-height: var(--control-height-touch);
    }
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
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .activity-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: var(--font-size-body, 14px);
  }
  .atime {
    color: var(--color-muted-foreground);
    min-width: 7rem;
    font-size: var(--font-size-caption, 12px);
  }
  /* PeekLink (ticket rows) renders its own scoped `<a>`, so this must be
     :global — same reasoning as `.void-btn` below. */
  :global(.amain) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
  }
  .aamount {
    font-variant-numeric: tabular-nums;
    min-width: 4rem;
    text-align: right;
  }
  /* How the sale was tendered — opens the ticket, where the method is corrected. */
  .apay {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }
  .stock-chip.ok {
    color: var(--color-success);
  }
  .stock-chip.warn {
    color: var(--color-warning);
  }
  /* Sizing comes from the Button primitive (xs); only the danger colour is ours.
     NOT scoped under `.pos-sell-surface`: this button lives in the unified
     activity popover, whose panel now portals to <body> (Popover.svelte), so
     no ancestor of this page is in its selector path. `.void-btn` exists only
     here. */
  :global(.void-btn) {
    color: var(--color-danger-fg);
    border-color: var(--color-danger-border);
    margin-left: auto;
  }
  :global(.activity-more) {
    text-align: center;
    padding-top: var(--space-1, 4px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-accent);
  }
  :global(.activity-more:hover) {
    text-decoration: underline;
  }
</style>
