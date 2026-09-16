import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
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
  const [bookings, eventTypes] = await Promise.all([
    listBookings(ctx, { from, to, limit: 2000, maskAttendeePii }),
    listEventTypes(ctx),
  ]);

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

  return {
    day,
    view,
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
    })),
    resources: resources
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, name: r.name, color: r.color })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
    })),
    stockEnabled: locals.moduleStates?.stock ?? true,
    accrualSummaries,
  };
};
