/**
 * Shared server load for the bookings surfaces (spec
 * `2026-08-17-hub-pos-appointments-fork`, slice 2).
 *
 * Extracted verbatim from `(app)/scheduling/bookings/+page.server.ts` so a
 * second route can render the same `BookingsView` without a second copy of the
 * query orchestration. Only genuinely route-specific knobs are options — the
 * load-dependency key, the rolling window, the row cap and whether the route
 * honours the `?contact=` / `?new=` cross-module deep link. Presentation knobs
 * (columns, labels, capabilities) belong to the component, not here.
 *
 * Form actions deliberately stay on their routes: SvelteKit resolves actions
 * per route and runs them before loads re-run.
 */
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { getContact } from '$server/services/crm-contacts.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
import { effectiveModuleEnabled } from '$lib/modules/availability';

const DAY = 86_400_000;

/** The subset of a SvelteKit load event this loader consumes. */
export type BookingsViewLoadEvent = {
  locals: App.Locals;
  depends: (dep: string) => void;
  url: URL;
};

/**
 * Booking window applied when no contact scope is in play.
 *
 * `now` (default) is the scheduling rolling window; `today` is the front-desk
 * day book — server-local midnight of today through `afterDays` later.
 */
export type BookingsWindow =
  | { anchor?: 'now'; beforeDays: number; afterDays: number }
  | { anchor: 'today'; afterDays: number };

/**
 * How the stock accrual chips are gated.
 *
 * `effective` (default, scheduling) consults `effectiveModuleEnabled`, so a
 * personal-kind org skips the accrual read entirely (S3/WP1 R6).
 * `module-state` reads the raw toggle and still *attempts* the read fail-soft.
 *
 * TODO(handoff): the `module-state` gate is the POS fork's shipped drift —
 * `/pos/appointments` reports stock enabled for a personal-kind org where
 * `/scheduling/bookings` reports it disabled. Preserved verbatim here (spec
 * `2026-08-17-hub-pos-appointments-fork-spec` §7 forbids fixing kind-leaks in
 * this refactor); the fix is owned by `2026-07-22-personal-org-differentiation-spec`
 * (WP1, `effectiveModuleEnabled`) and is a one-line change to this option.
 */
export type BookingsStockGate = 'effective' | 'module-state';

export interface LoadBookingsViewOptions {
  /** Load-dependency key the route's mutations invalidate. */
  dependsKey: string;
  /** Window around "now"/"today", in days, used when no contact scope applies. */
  window: BookingsWindow;
  /** Row cap handed to `listBookings`. */
  limit: number;
  /** Drop retired resources before they reach the view (front-desk pickers). */
  activeResourcesOnly?: boolean;
  /** Accrual-chip gate. Defaults to `effective`. */
  stockGate?: BookingsStockGate;
  /**
   * Honour `?contact=` (show ALL of one contact's bookings, unwindowed) and
   * `?new=1` (open the New-booking modal pre-bound to that contact). Adds
   * `contactId` / `contactName` / `openNew` to the returned data.
   */
  contactScope?: boolean;
}

type Bookings = Awaited<ReturnType<typeof listBookings>>;
type AccrualSummaries = Awaited<ReturnType<typeof accrualSummaryForSources>>;

export interface BookingsViewLoadData {
  bookings: Bookings;
  resources: Array<{ id: string; name: string }>;
  eventTypes: Array<{ id: string; title: string; productId: string | null }>;
  stockEnabled: boolean;
  accrualSummaries: AccrualSummaries;
}

export interface BookingsViewContactScope {
  contactId: string | null;
  contactName: string | null;
  openNew: boolean;
}

/** Resolves a window descriptor into the `from`/`to` pair `listBookings` takes. */
function windowRange(window: BookingsWindow): { from: Date; to: Date } {
  if (window.anchor === 'today') {
    // ponytail: server-local midnight, not per-org timezone — fine for a
    // single-org front-desk view; add per-org tz if a multi-tz org shows up.
    const from = new Date(new Date().setHours(0, 0, 0, 0));
    return { from, to: new Date(from.getTime() + window.afterDays * DAY) };
  }
  const now = Date.now();
  return {
    from: new Date(now - window.beforeDays * DAY),
    to: new Date(now + window.afterDays * DAY),
  };
}

export async function loadBookingsView(
  event: BookingsViewLoadEvent,
  opts: LoadBookingsViewOptions & { contactScope: true },
): Promise<BookingsViewLoadData & BookingsViewContactScope>;
export async function loadBookingsView(
  event: BookingsViewLoadEvent,
  opts: LoadBookingsViewOptions & { contactScope?: false },
): Promise<BookingsViewLoadData>;
export async function loadBookingsView(
  { locals, depends, url }: BookingsViewLoadEvent,
  opts: LoadBookingsViewOptions,
): Promise<BookingsViewLoadData | (BookingsViewLoadData & BookingsViewContactScope)> {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends(opts.dependsKey);

  // Cross-module nav: ?contact= shows ALL of one contact's bookings (no window),
  // ?new=1 opens the New-appointment modal pre-bound to that contact.
  const contact = opts.contactScope ? (url.searchParams.get('contact') ?? undefined) : undefined;
  const openNew = opts.contactScope === true && url.searchParams.get('new') === '1';

  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const bookingsOpts = contact
    ? { crmContactId: contact, limit: opts.limit, maskAttendeePii }
    : { ...windowRange(opts.window), limit: opts.limit, maskAttendeePii };
  const [bookings, resources, eventTypes, contactRec] = await Promise.all([
    listBookings(ctx, bookingsOpts),
    listResources(ctx),
    listEventTypes(ctx),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);

  // S3/WP1 R6: stock is now kind-hidden for personal orgs (not just
  // toggle-gated) — skip the accrual read entirely instead of relying on the
  // try/catch to swallow a query that shouldn't run. The `module-state` gate
  // keeps the POS fork's looser behaviour (raw toggle, read always attempted).
  const rawStock = opts.stockGate === 'module-state';
  const stockEnabled = rawStock
    ? (locals.moduleStates?.stock ?? true)
    : effectiveModuleEnabled(locals.orgKind, locals.moduleStates ?? {}, 'stock');
  let accrualSummaries: AccrualSummaries = [];
  if (rawStock || stockEnabled) {
    try {
      accrualSummaries = await accrualSummaryForSources(
        ctx,
        'booking',
        bookings.map((b) => b.id),
      );
    } catch {
      // stock module absent/off — bookings render without chips
    }
  }

  const base: BookingsViewLoadData = {
    bookings,
    resources: resources
      .filter((r) => !opts.activeResourcesOnly || r.active)
      .map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
    })),
    stockEnabled,
    accrualSummaries,
  };
  if (!opts.contactScope) return base;
  return {
    ...base,
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
    openNew,
  };
}
