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
  opts: { from: Date; to: Date; eventTypes: CalendarWindowEventType[]; pos: boolean },
) {
  const { from, to, eventTypes, pos } = opts;

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
  const categories = await categoryColorsForProducts(ctx, [
    ...new Set(bookings.map(productOf).filter((v): v is string => !!v)),
  ]).catch(() => new Map<string, { name: string; color: string }>());

  // Submitted tickets in the same window — the "Invoiced" half of the POS split
  // view. Money never reaches the scheduling calendar, which has no such column.
  const tickets = pos ? await listTicketsForCalendar(ctx, { from, to }).catch(() => []) : [];

  let accrualSummaries: Awaited<ReturnType<typeof accrualSummaryForSources>> = [];
  if (pos) {
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
      /** The member's own duration in minutes before it joined the visit (`metadata.groupLength`). */
      groupLength: (b.metadata as { groupLength?: number } | null)?.groupLength ?? null,
      tags: tagsByBooking.get(b.id) ?? [],
      /** Own kind, else the service's default; null → the org default kind. */
      kindId: b.kindId ?? eventTypes.find((e) => e.id === b.eventTypeId)?.kindId ?? null,
      category: categories.get(productOf(b) ?? '')?.name ?? null,
      categoryColor: categories.get(productOf(b) ?? '')?.color ?? null,
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
