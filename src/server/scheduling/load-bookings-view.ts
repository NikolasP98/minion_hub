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

export interface LoadBookingsViewOptions {
  /** Load-dependency key the route's mutations invalidate. */
  dependsKey: string;
  /** Rolling window around "now", in days, used when no contact scope applies. */
  window: { beforeDays: number; afterDays: number };
  /** Row cap handed to `listBookings`. */
  limit: number;
  /**
   * Honour `?contact=` (show ALL of one contact's bookings, unwindowed). Adds
   * `contactId` / `contactName` to the returned data.
   */
  contactScope?: boolean;
}

type Bookings = Awaited<ReturnType<typeof listBookings>>;
type AccrualSummaries = Awaited<ReturnType<typeof accrualSummaryForSources>>;

export interface BookingsViewLoadData {
  bookings: Bookings;
  resources: Array<{ id: string; name: string }>;
  eventTypes: Array<{
    id: string;
    title: string;
    productId: string | null;
    active: boolean;
    length: number;
  }>;
  stockEnabled: boolean;
  accrualSummaries: AccrualSummaries;
}

export interface BookingsViewContactScope {
  contactId: string | null;
  contactName: string | null;
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

  // Cross-module nav: ?contact= shows ALL of one contact's bookings (no window).
  const contact = opts.contactScope ? (url.searchParams.get('contact') ?? undefined) : undefined;

  const now = Date.now();
  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const bookingsOpts = contact
    ? { crmContactId: contact, limit: opts.limit, maskAttendeePii }
    : {
        from: new Date(now - opts.window.beforeDays * DAY),
        to: new Date(now + opts.window.afterDays * DAY),
        limit: opts.limit,
        maskAttendeePii,
      };
  const [bookings, resources, eventTypes, contactRec] = await Promise.all([
    listBookings(ctx, bookingsOpts),
    listResources(ctx),
    listEventTypes(ctx),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);

  // S3/WP1 R6: stock is now kind-hidden for personal orgs (not just
  // toggle-gated) — skip the accrual read entirely instead of relying on the
  // try/catch to swallow a query that shouldn't run.
  const stockEnabled = effectiveModuleEnabled(locals.orgKind, locals.moduleStates ?? {}, 'stock');
  let accrualSummaries: AccrualSummaries = [];
  if (stockEnabled) {
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
    resources: resources.map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
    })),
    stockEnabled,
    accrualSummaries,
  };
  if (!opts.contactScope) return base;
  return {
    ...base,
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
  };
}
