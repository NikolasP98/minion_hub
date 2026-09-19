import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import {
  listResources,
  listEventTypes,
  getResourceSchedule,
} from '$server/services/scheduling.service';
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
  const activeResources = resources.filter((r) => r.active);
  const [bookings, eventTypes, schedules] = await Promise.all([
    listBookings(ctx, { from, to, limit: 2000, maskAttendeePii }),
    listEventTypes(ctx),
    Promise.all(activeResources.map((r) => getResourceSchedule(ctx, r.id))),
  ]);

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
    resources: activeResources.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    hours,
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
