import type { CoreCtx } from '$server/auth/core-ctx';
import { isDenied, type DatasetDenied } from '$lib/permissions';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings, visitsOfBookings } from '$server/services/scheduling-bookings.service';
import { categoryColorsForProducts } from '$server/services/finance-products.service';
import { stockAnchorForBookings } from '$server/services/stock-accruals.service';
import { getTagLinks, getContactTagsBulk } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import {
  bookingTicketLinks,
  listTicketsForCalendar,
  type BookingTicketLink,
} from '$server/services/pos-accounts.service';
import type { CalendarBookingTag } from '$lib/components/scheduling/calendar-window';
import {
  soldRowsForVisit,
  type CalendarProductFacets,
  type SoldFacet,
  type TicketOverlayFacet,
} from '$lib/components/scheduling/booking-product-facets';

const DENIED = (module: 'pos' | 'stock' | 'crm'): DatasetDenied => ({
  denied: module,
  verb: 'view',
});

/** The subset of an event type the window needs for `kindId`/`productOf`
 *  resolution — callers already have the full list loaded (once per page
 *  load), so it rides in as an argument instead of a second query. */
export interface CalendarWindowEventType {
  id: string;
  productId?: string | null;
  kindId?: string | null;
}

/**
 * The ONE view-windowed calendar read, shared by `/pos/appointments` and
 * `/scheduling/calendar` (spec 2026-09-27 S3): bookings projected to
 * `BookingCalendar`'s compact shape (with tags/kind/category colour/group
 * fields resolved) plus the tag filter's options.
 *
 * `pos: true` adds the POS-only half — the submitted tickets in the window
 * (the "Invoiced" split column) and their stock-accrual chips. `pos: false`
 * skips both reads entirely and answers with empty lists, so the scheduling
 * calendar never pays for (or leaks) POS money data.
 *
 * Every other load key (`day, view, resources, hours, eventTypes, kinds,
 * categories, …`) stays on the caller — those are not window-scoped.
 *
 * PII: `maskAttendeePii` comes from `shouldMaskSensitive(locals, 'scheduling')`
 * for BOTH surfaces — the same field-level rule the retired
 * `src/server/scheduling/load-calendar-events.ts` applied.
 */
export async function loadCalendarWindow(
  ctx: CoreCtx,
  locals: App.Locals,
  opts: {
    from: Date;
    to: Date;
    eventTypes: CalendarWindowEventType[];
    pos: boolean;
    /** `finance:view` + the finance field tier: only then do sold rows carry the `gift` flag
     *  (spec 126 decision 3); otherwise it is null. Omitted → not admitted. */
    canReadFinancialFields?: boolean;
    /** `ctx` is the SCHEDULING handle. Each foreign dataset is read through its own handle (spec
     *  039): a denied one degrades its slice (no money, chips, colours or tags), never leaks.
     *  Omitted (or a missing member) = DENIED for that dataset: every caller resolves them with
     *  `datasetCtx(locals, …)`. */
    foreign?: {
      pos?: CoreCtx | DatasetDenied;
      stock?: CoreCtx | DatasetDenied;
      crm?: CoreCtx | DatasetDenied;
    };
  },
) {
  const { from, to, eventTypes } = opts;
  // Fail closed: a caller that omits `foreign` (or a member of it) gets that dataset DENIED, never a read
  // through the scheduling handle, which would bypass the pos/stock/crm dataset gates.
  const foreign = {
    pos: opts.foreign?.pos ?? DENIED('pos'),
    stock: opts.foreign?.stock ?? DENIED('stock'),
    crm: opts.foreign?.crm ?? DENIED('crm'),
  };
  const pos = opts.pos && !isDenied(foreign.pos);

  // TODO(handoff): no status filter — every status reaches the grid, including
  // cancelled/rejected/no_show. That is what `/pos/appointments` always did; the
  // retired `src/server/scheduling/load-calendar-events.ts` clipped
  // `/scheduling/calendar` to accepted|pending|completed, so the team calendar
  // gained those boxes with S3. Deliberate convergence; a "hide cancelled"
  // toggle belongs in `BookingCalendar`'s kebab as a generic feature, never as a
  // branch here. Ledger §39,
  // proposals/2026-09-25-hub-pos-calendar-color-followups.md.
  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const bookings = await listBookings(ctx, { from, to, limit: 2000, maskAttendeePii });

  // Name + colour of each booking's product category — the one interchangeable
  // colour source whose colour the client can't derive (`fin_products.category`
  // is plain text; the colour lives on `fin_product_categories`), and since
  // HC-020 the value the `category` subcolumn groups on. The service's product
  // stands in when the booking itself carries none. Fail-soft: a missing POS
  // module must never cost the operator the calendar.
  const productOf = (b: (typeof bookings)[number]): string | null =>
    b.productId ?? eventTypes.find((e) => e.id === b.eventTypeId)?.productId ?? null;
  const categories = isDenied(foreign.pos)
    ? new Map<string, { name: string; color: string }>()
    : await categoryColorsForProducts(foreign.pos, [
        ...new Set(bookings.map(productOf).filter((v): v is string => !!v)),
      ]).catch(() => new Map<string, { name: string; color: string }>());

  // Submitted tickets in the same window — the "Invoiced" half of the POS split
  // view. Money never reaches the scheduling calendar, which has no such column.
  // Spec 126: the overlay is a READ facet — a failed or capped read is `unavailable`, never a
  // successful `[]`. Only the POS host with POS view AND finance admission reads it (it carries
  // ticket totals); the scheduling host answers `denied` without a read.
  // TODO(handoff): the contract's owned REPEATABLE READ READ ONLY reader with line/text/byte limits is
  // not built; this reuses `listTicketsForCalendar` (capped at 2,000 headers → `capacity`).
  const money = opts.canReadFinancialFields === true;
  let ticketOverlay: TicketOverlayFacet = { state: 'denied' };
  if (pos && !isDenied(foreign.pos) && money) {
    try {
      const tickets = await listTicketsForCalendar(foreign.pos, { from, to });
      ticketOverlay =
        tickets.length === 0
          ? { state: 'empty' }
          : tickets.length >= 2000
            ? { state: 'unavailable', reason: 'capacity' }
            : {
                state: 'available',
                value: {
                  rows: tickets.map((t) => ({
                    id: t.id,
                    humanId: t.humanId,
                    at: t.submittedAt.toISOString(),
                    total: Number(t.total),
                    currency: t.currency,
                    customerName: t.customerName,
                    lines: t.lines,
                  })),
                },
              };
    } catch {
      ticketOverlay = { state: 'unavailable', reason: 'read_failed' };
    }
  }
  // Per-booking paid-ness for the event context menu (spec 2026-10-13 D3):
  // anchored on the line's booking_id, NOT the window — a ticket sold weeks
  // ago still marks its booking paid. Two statements over the window's ids.
  let ticketLinksFailed = false;
  const ticketLinks =
    pos && !isDenied(foreign.pos)
      ? await bookingTicketLinks(
          foreign.pos,
          bookings.map((b) => b.id),
        ).catch(() => {
          ticketLinksFailed = true;
          return new Map<string, BookingTicketLink[]>();
        })
      : new Map<string, BookingTicketLink[]>();
  // Spec 126: the SAME sold projection the detail uses, per visit (anchor +
  // authorized members resolved from the window's rows). The scheduling host
  // reads no sales, so its sold facet is `not_in_slice`, never an empty list.
  const visits = visitsOfBookings(bookings);
  const soldFor = (b: (typeof bookings)[number]): SoldFacet => {
    if (!opts.pos) return { state: 'unavailable', reason: 'not_in_slice' };
    if (isDenied(foreign.pos)) return { state: 'denied' };
    if (ticketLinksFailed) return { state: 'unavailable', reason: 'read_failed' };
    const visit = visits.get(b.id) ?? { anchorId: b.id, memberIds: new Set([b.id]) };
    const lines = [...visit.memberIds].flatMap((id) =>
      (ticketLinks.get(id) ?? []).flatMap((t) => t.products),
    );
    return soldRowsForVisit(lines, visit, opts.canReadFinancialFields === true);
  };

  // Reduced payment facet (the window has no price or amount readers): present only with POS view AND
  // the finance field tier; the legacy `paid`/`funding`/`tickets` aliases below exist only then.
  const paymentFor = (b: (typeof bookings)[number]): CalendarProductFacets['payment'] => {
    if (!opts.pos) return { state: 'unavailable', reason: 'not_in_slice' };
    if (isDenied(foreign.pos) || !money) return { state: 'denied' };
    if (ticketLinksFailed) return { state: 'unavailable', reason: 'read_failed' };
    const links = ticketLinks.get(b.id) ?? [];
    return {
      state: 'available',
      value: {
        paid: links.length > 0,
        funding: b.packageGrantId ? 'grant' : b.paymentPlanId ? 'plan' : 'cash',
        tickets: links.map((t) => ({ id: t.id, humanId: t.humanId })),
      },
    };
  };

  // Cost-free accrual counts for the SERVER-RESOLVED visit anchors (spec decision 4). One read; a
  // failure or over-limit window makes the stock facet unavailable, never the bookings.
  let stockAnchors: Awaited<ReturnType<typeof stockAnchorForBookings>> | null = null;
  let stockFailure: 'read_failed' | 'capacity' | null = null;
  if (pos && !isDenied(foreign.stock)) {
    try {
      stockAnchors = await stockAnchorForBookings(foreign.stock, [
        ...new Set(bookings.map((b) => (visits.get(b.id) ?? { anchorId: b.id }).anchorId)),
      ]);
    } catch (e) {
      stockFailure = e instanceof Error && e.message === 'capacity' ? 'capacity' : 'read_failed';
    }
  }
  const stockFor = (b: (typeof bookings)[number]): CalendarProductFacets['stock'] => {
    if (!opts.pos) return { state: 'unavailable', reason: 'not_in_slice' };
    if (isDenied(foreign.stock)) return { state: 'denied' };
    if (stockFailure) return { state: 'unavailable', reason: stockFailure };
    const anchorId = (visits.get(b.id) ?? { anchorId: b.id }).anchorId;
    return { state: 'available', value: { anchorAccrual: stockAnchors?.get(anchorId) ?? null } };
  };

  // Tags on each event: own (event scope) + the client's + the service's —
  // dots on the boxes and the toolbar filter. Fail-soft: a tag read must never
  // cost the operator the calendar.
  const tagsByBooking = new Map<string, CalendarBookingTag[]>();
  const tagOptions = new Map<
    string,
    { id: string; name: string; color: string | null; origin?: 'contact' | 'product' }
  >();
  try {
    if (isDenied(foreign.crm)) throw new Error('crm denied'); // no tag reads without CRM view
    const crm = foreign.crm;
    const productIds = [
      ...new Set(bookings.map((b) => b.productId).filter((v): v is string => !!v)),
    ];
    const contactIds = [
      ...new Set(bookings.map((b) => b.crmContactId).filter((v): v is string => !!v)),
    ];
    const [own, byEventType, byProduct, byContact, registry] = await Promise.all([
      getTagLinks(
        crm,
        'booking',
        bookings.map((b) => b.id),
      ),
      getTagLinks(crm, 'event_type', [...new Set(bookings.map((b) => b.eventTypeId))]),
      getTagLinks(crm, 'product', productIds),
      getContactTagsBulk(crm, contactIds),
      listTags(crm, 'event'),
    ]);
    for (const t of registry) {
      if (t.kind === 'manual') tagOptions.set(t.id, { id: t.id, name: t.name, color: t.color });
    }
    for (const b of bookings) {
      const seen = new Set<string>();
      const list: CalendarBookingTag[] = [];
      const push = (
        tags: { id: string; name: string; color: string | null }[],
        origin: CalendarBookingTag['origin'],
      ) => {
        for (const t of tags) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          list.push({ ...t, origin });
          if (!tagOptions.has(t.id)) {
            tagOptions.set(t.id, {
              id: t.id,
              name: t.name,
              color: t.color,
              ...(origin === 'own' ? {} : { origin }),
            });
          }
        }
      };
      push(own.get(b.id) ?? [], 'own');
      push(b.crmContactId ? (byContact.get(b.crmContactId) ?? []) : [], 'contact');
      push(byEventType.get(b.eventTypeId) ?? [], 'product');
      push(b.productId ? (byProduct.get(b.productId) ?? []) : [], 'product');
      tagsByBooking.set(b.id, list);
    }
  } catch {
    // tags absent — calendar renders without dots/filter options
  }

  /** The facets, plus the legacy `paid`/`funding`/`tickets` aliases ONLY when derived from an
   *  admitted payment facet (never `paid: false` or `cash` from a denied or failed read). */
  const bookingProductProjection = (b: (typeof bookings)[number]) => {
    const payment = paymentFor(b);
    const productFacets: CalendarProductFacets = {
      version: 1,
      sold: soldFor(b),
      payment,
      stock: stockFor(b),
    };
    return payment.state === 'available'
      ? {
          productFacets,
          paid: payment.value.paid,
          funding: payment.value.funding,
          tickets: payment.value.tickets,
        }
      : { productFacets };
  };

  return {
    productProjectionVersion: 1 as const,
    bookings: bookings.map((b) => ({
      id: b.id,
      resourceId: b.resourceId,
      eventTypeId: b.eventTypeId,
      start: b.startTime.toISOString(),
      end: b.endTime.toISOString(),
      status: b.status,
      attendeeName: b.attendeeName,
      attendeePhone: b.attendeePhone,
      partyId: b.partyId ?? null,
      productId: b.productId ?? null,
      /** Internal note — the hover card shows it read-only; the drawer edits it. */
      notes: b.notes ?? null,
      checkup: Boolean((b.metadata as { followUpOf?: unknown } | null)?.followUpOf),
      /** Merged visit (`metadata.groupId`): members render as ONE box. */
      groupId: (b.metadata as { groupId?: string } | null)?.groupId ?? null,
      /** Order inside a merged visit (`metadata.groupSeq`, 0 = lead). */
      groupSeq: (b.metadata as { groupSeq?: number } | null)?.groupSeq ?? null,
      /** The member's own duration in minutes before it joined the visit (`metadata.groupLength`). */
      groupLength: (b.metadata as { groupLength?: number } | null)?.groupLength ?? null,
      tags: tagsByBooking.get(b.id) ?? [],
      /** Own kind, else the service's default; null → the org default kind. */
      kindId: b.kindId ?? eventTypes.find((e) => e.id === b.eventTypeId)?.kindId ?? null,
      category: categories.get(productOf(b) ?? '')?.name ?? null,
      categoryColor: categories.get(productOf(b) ?? '')?.color ?? null,
      ...bookingProductProjection(b),
    })),
    tagOptions: [...tagOptions.values()],
    ticketOverlay,
  };
}
