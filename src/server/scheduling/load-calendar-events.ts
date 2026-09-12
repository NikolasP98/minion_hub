/**
 * Server load for the scheduling calendar (spec
 * 2026-09-08-hub-scheduling-calendar-views-tags-spec §2.3). Denormalises
 * bookings for display: resource + event type (kind fallback) + product,
 * batched tag reads (own tags, contact tags, product tags).
 */
import { and, eq, gt, lt, inArray } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { maskPii } from '$lib/pii';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedBookings, schedResources, schedEventTypes } from '$server/db/pg-scheduling-schema';
import { finProducts, finInvoices } from '$server/db/pg-finance-schema';
import { getTagLinks, getContactTagsBulk } from '$server/services/tag-links.service';
import { toOffsetIsoString } from './tz';
import type { CalEvent } from '$lib/components/scheduling/calendar/types';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 62;
// Same set listBookings/loadBookingsView treat as "on the calendar" (excludes
// cancelled/rejected/no_show, which never occupy a slot going forward).
const CALENDAR_STATUSES = ['accepted', 'pending', 'completed'] as const;

export class CalendarRangeTooLargeError extends Error {
  constructor() {
    super(`calendar range exceeds ${MAX_RANGE_DAYS} days`);
    this.name = 'CalendarRangeTooLargeError';
  }
}

export interface LoadCalendarEventsOpts {
  from: Date;
  to: Date;
  /** Field-level (Phase 4): redact attendeePhone below the scheduling field level, like listBookings. */
  maskAttendeePii: boolean;
}

export async function loadCalendarEvents(
  ctx: CoreCtx,
  opts: LoadCalendarEventsOpts,
): Promise<CalEvent[]> {
  if (opts.to.getTime() - opts.from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new CalendarRangeTooLargeError();
  }

  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        id: schedBookings.id,
        start: schedBookings.startTime,
        end: schedBookings.endTime,
        status: schedBookings.status,
        title: schedBookings.title,
        notes: schedBookings.notes,
        crmContactId: schedBookings.crmContactId,
        attendeeName: schedBookings.attendeeName,
        attendeePhone: schedBookings.attendeePhone,
        productId: schedBookings.productId,
        bookingKindId: schedBookings.kindId,
        resourceId: schedResources.id,
        resourceName: schedResources.name,
        resourceTimezone: schedResources.timezone,
        resourceColor: schedResources.color,
        eventTypeId: schedEventTypes.id,
        eventTypeTitle: schedEventTypes.title,
        eventTypeKindId: schedEventTypes.kindId,
        productName: finProducts.name,
        invoiceId: schedBookings.invoiceId,
        invoiceDocumentId: finInvoices.documentId,
        invoiceNumber: finInvoices.number,
      })
      .from(schedBookings)
      .innerJoin(schedResources, eq(schedResources.id, schedBookings.resourceId))
      .innerJoin(schedEventTypes, eq(schedEventTypes.id, schedBookings.eventTypeId))
      .leftJoin(finProducts, eq(finProducts.id, schedBookings.productId))
      .leftJoin(finInvoices, eq(finInvoices.id, schedBookings.invoiceId))
      .where(
        and(
          eq(schedBookings.orgId, ctx.tenantId),
          inArray(schedBookings.status, [...CALENDAR_STATUSES]),
          // Include bookings that start before `from` but are still in progress
          // (end after `from`), not just ones that start inside the window.
          gt(schedBookings.endTime, opts.from),
          lt(schedBookings.startTime, opts.to),
        ),
      ),
  );
  if (!rows.length) return [];

  const bookingIds = rows.map((r) => r.id);
  const productIds = [...new Set(rows.map((r) => r.productId).filter((v): v is string => !!v))];
  const contactIds = [...new Set(rows.map((r) => r.crmContactId).filter((v): v is string => !!v))];

  const [bookingTags, productTags, contactTags] = await Promise.all([
    getTagLinks(ctx, 'booking', bookingIds),
    getTagLinks(ctx, 'product', productIds),
    getContactTagsBulk(ctx, contactIds),
  ]);

  return rows.map((r) => ({
    id: r.id,
    // Wall clock + explicit offset, never `Z` — see toOffsetIsoString.
    start: toOffsetIsoString(r.start, r.resourceTimezone),
    end: toOffsetIsoString(r.end, r.resourceTimezone),
    status: r.status,
    resourceId: r.resourceId,
    resourceName: r.resourceName,
    resourceColor: r.resourceColor,
    kindId: r.bookingKindId ?? r.eventTypeKindId ?? null,
    eventTypeId: r.eventTypeId,
    eventTypeTitle: r.eventTypeTitle,
    title: r.title,
    notes: r.notes,
    crmContactId: r.crmContactId,
    attendeeName: r.attendeeName,
    attendeePhone:
      opts.maskAttendeePii && r.attendeePhone ? maskPii(r.attendeePhone) : r.attendeePhone,
    productId: r.productId,
    productName: r.productName ?? null,
    invoiceId: r.invoiceId,
    invoiceLabel: r.invoiceDocumentId ?? r.invoiceNumber ?? null,
    tags: bookingTags.get(r.id) ?? [],
    contactTags: r.crmContactId ? (contactTags.get(r.crmContactId) ?? []) : [],
    productTags: r.productId ? (productTags.get(r.productId) ?? []) : [],
  }));
}
