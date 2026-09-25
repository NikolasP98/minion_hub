import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import {
  listResources,
  listEventTypes,
  listEventKinds,
  getResourceSchedule,
} from '$server/services/scheduling.service';
import { categoryColorsForProducts } from '$server/services/finance-products.service';
import { listProductCategories } from '$server/services/pos-categories.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
import { getTagLinks, getContactTagsBulk } from '$server/services/tag-links.service';
import { listTags } from '$server/services/crm-contacts.service';
import type { CalendarBookingTag } from '$lib/components/scheduling/calendar-window';
import {
  listPendingSchedulingLines,
  listTicketsForCalendar,
} from '$server/services/pos-accounts.service';
import {
  calendarInstantWindow,
  parseCalendarDate,
  parseCalendarView,
  todayIn,
} from '$lib/components/scheduling/calendar-window';

/** View perm (`pos.appointments:view`) is enforced centrally by the root layout
 *  guard (MODULE_SUBRESOURCES). The pos+scheduling composite module-toggle 404
 *  is enforced centrally by the (app) route hook guard now (routing-
 *  simplification spec S2 — `/pos/appointments` maps to the `posAppointments`
 *  composite manifest entry) — this load only fetches the tab's data. */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:appointments');

  // The org timezone rides on the resources, exactly like /scheduling/calendar —
  // the two calendars must resolve the SAME window for the same ?view/?date.
  const resources = await listResources(ctx);
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';

  const view = parseCalendarView(url.searchParams.get('view'));
  const day = parseCalendarDate(url.searchParams.get('date'), todayIn(orgTz));
  const { from, to } = calendarInstantWindow(day, view, orgTz);

  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const activeResources = resources.filter((r) => r.active);
  const [bookings, eventTypes, kinds, schedules] = await Promise.all([
    listBookings(ctx, { from, to, limit: 2000, maskAttendeePii }),
    listEventTypes(ctx),
    listEventKinds(ctx),
    Promise.all(activeResources.map((r) => getResourceSchedule(ctx, r.id))),
  ]);

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
  // The same column's VALUE list — previewed when the operator hovers the
  // `category` option in the calendar's colour picker. Fail-soft for the same
  // reason as the colours above (a missing POS module must not cost the grid).
  const categories = await listProductCategories(ctx).catch(() => []);

  // Off-hours shading envelope per resource: weekday → [earliest open, latest
  // close] in minutes, from the weekly (date-less) rules. Single-date overrides
  // are ignored here — the shade marks the usual working window.
  const toMin = (hhmm: string) => {
    const [h, mm] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (mm ?? 0);
  };
  const hours: Record<string, Partial<Record<number, [number, number]>>> = {};
  activeResources.forEach((r, i) => {
    if (!schedules[i]) return; // no schedule at all → unknown, not closed
    const week: Partial<Record<number, [number, number]>> = {};
    for (const rule of schedules[i]?.rules ?? []) {
      if (rule.date) continue;
      for (const d of rule.days) {
        const prev = week[d];
        const open = toMin(rule.startTime);
        const close = toMin(rule.endTime);
        week[d] = prev ? [Math.min(prev[0], open), Math.max(prev[1], close)] : [open, close];
      }
    }
    hours[r.id] = week;
  });

  // Paid-but-unscheduled service lines for the drag-in tray. Fail-soft: the
  // calendar must render even if POS is off or the read fails.
  const pending = await listPendingSchedulingLines(ctx, { limit: 200 }).catch(() => []);
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
    day,
    view,
    /** Event-scope registry + every tag present on a shown event — the filter's options. */
    tagOptions: [...tagOptions.values()],
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
      checkup: Boolean((b.metadata as { followUpOf?: unknown } | null)?.followUpOf),
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
    resources: activeResources.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    hours,
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
      /** Both are event-colour sources (see `booking-color.ts`). */
      color: e.color,
      kindId: e.kindId,
    })),
    /** Org event kinds with their colours — the `kind` colour source. `name`
     *  is only for the picker's value preview; the resolver never reads it. */
    kinds: kinds.map((k) => ({ id: k.id, name: k.name, color: k.color, isDefault: k.isDefault })),
    /** `fin_product_categories` for the org — the `category` source's values. */
    categories: categories.map((c) => ({ name: c.name, color: c.color })),
    stockEnabled: locals.moduleStates?.stock ?? true,
    accrualSummaries,
    pending: pending.map((p) => ({ ...p, submittedAt: p.submittedAt.toISOString() })),
  };
};
