import type { CoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { categoryColorsForProducts } from '$server/services/finance-products.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
import { getTagLinks, getContactTagsBulk } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import { listTicketsForCalendar } from '$server/services/pos-accounts.service';
import type { CalendarBookingTag } from '$lib/components/scheduling/calendar-window';

/** The subset of an event type the window needs for `kindId`/`productOf`
 *  resolution — callers already have the full list loaded (once per page
 *  load), so it rides in as an argument instead of a second query. */
export interface PosCalendarEventType {
  id: string;
  productId?: string | null;
  kindId?: string | null;
}

/**
 * The view-windowed half of the `/pos/appointments` load: bookings projected
 * to `BookingCalendar`'s compact shape (with tags/kind/category colour/group
 * fields resolved), the submitted tickets in the window, their stock-accrual
 * chips, and the tag filter's options.
 *
 * Extracted VERBATIM from `+page.server.ts` (behaviour-preserving) so the
 * range endpoint (`GET /api/pos/appointments`) and the page's own SSR load
 * can share one implementation instead of drifting. Every other load key
 * (`day, view, resources, hours, eventTypes, kinds, categories, stockEnabled,
 * pending`) stays on the caller — those are not window-scoped.
 */
export async function loadPosCalendarWindow(
  ctx: CoreCtx,
  locals: App.Locals,
  opts: { from: Date; to: Date; eventTypes: PosCalendarEventType[] },
) {
  const { from, to, eventTypes } = opts;

  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const bookings = await listBookings(ctx, { from, to, limit: 2000, maskAttendeePii });

  // Colour of each booking's product category — the one interchangeable colour
  // source whose colour the client can't derive (`fin_products.category` is
  // plain text; the colour lives on `fin_product_categories`). The service's
  // product stands in when the booking itself carries none. Fail-soft: a
  // missing POS module must never cost the operator the calendar.
  const productOf = (b: (typeof bookings)[number]): string | null =>
    b.productId ?? eventTypes.find((e) => e.id === b.eventTypeId)?.productId ?? null;
  const categoryColors = await categoryColorsForProducts(ctx, [
    ...new Set(bookings.map(productOf).filter((v): v is string => !!v)),
  ]).catch(() => new Map<string, string>());

  // Submitted tickets in the same window — the "Invoiced" half of the split view.
  const tickets = await listTicketsForCalendar(ctx, { from, to }).catch(() => []);

  let accrualSummaries: Awaited<ReturnType<typeof accrualSummaryForSources>> = [];
  try {
    accrualSummaries = await accrualSummaryForSources(
      ctx,
      'booking',
      bookings.map((b) => b.id),
    );
  } catch {
    // stock module absent/off — bookings render without chips
  }

  // Tags on each event: own (event scope) + the client's + the service's —
  // dots on the boxes and the toolbar filter. Fail-soft: a tag read must never
  // cost the operator the calendar.
  const tagsByBooking = new Map<string, CalendarBookingTag[]>();
  const tagOptions = new Map<
    string,
    { id: string; name: string; color: string | null; origin?: 'contact' | 'product' }
  >();
  try {
    const productIds = [
      ...new Set(bookings.map((b) => b.productId).filter((v): v is string => !!v)),
    ];
    const contactIds = [
      ...new Set(bookings.map((b) => b.crmContactId).filter((v): v is string => !!v)),
    ];
    const [own, byEventType, byProduct, byContact, registry] = await Promise.all([
      getTagLinks(
        ctx,
        'booking',
        bookings.map((b) => b.id),
      ),
      getTagLinks(ctx, 'event_type', [...new Set(bookings.map((b) => b.eventTypeId))]),
      getTagLinks(ctx, 'product', productIds),
      getContactTagsBulk(ctx, contactIds),
      listTags(ctx, 'event'),
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

  return {
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
      tags: tagsByBooking.get(b.id) ?? [],
      /** Own kind, else the service's default; null → the org default kind. */
      kindId: b.kindId ?? eventTypes.find((e) => e.id === b.eventTypeId)?.kindId ?? null,
      categoryColor: categoryColors.get(productOf(b) ?? '') ?? null,
    })),
    invoices: tickets.map((t) => ({
      id: t.id,
      humanId: t.humanId,
      at: t.submittedAt.toISOString(),
      total: Number(t.total),
      currency: t.currency,
      customerName: t.customerName,
      lines: t.lines,
    })),
    accrualSummaries,
    tagOptions: [...tagOptions.values()],
  };
}
