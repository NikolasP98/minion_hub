import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listResources,
  listEventTypes,
  listEventKinds,
  getResourceSchedule,
} from '$server/services/scheduling.service';
import { listProductCategories } from '$server/services/pos-categories.service';
import { loadCalendarWindow } from '$server/services/calendar-window.service';
import {
  calendarLoadWindow,
  parseCalendarDate,
  parseCalendarView,
  parseCalendarPageView,
  calendarViewOf,
  todayIn,
} from '$lib/components/scheduling/calendar-window';

/** View perm (`scheduling.calendar:view`) and the module toggle are enforced
 *  centrally by the (app) route guard — this load only fetches the tab's data.
 *
 *  Since spec 2026-09-27 S3 this page renders the SAME `BookingCalendar` as
 *  `/pos/appointments` off the SAME window read (`loadCalendarWindow`), so the
 *  two calendars can no longer drift: identical window arithmetic, identical
 *  booking projection, identical tag/colour resolution. `pos: false` drops the
 *  POS-only halves (submitted tickets + stock-accrual chips). */
export const load: PageServerLoad = async ({ locals, depends, url, parent }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  // Reuse the (app) layout's already-loaded preferences bundle (no extra query).
  const { preferences } = await parent();
  const calendarPrefs = preferences.preferences.calendar as
    { showInheritedTags?: boolean } | undefined;
  const showInheritedTags = calendarPrefs?.showInheritedTags ?? true;

  // The org timezone rides on the resources, exactly like /pos/appointments —
  // the two calendars must resolve the SAME window for the same ?view/?date.
  const resources = await listResources(ctx);
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';

  const pageView = parseCalendarPageView(url.searchParams.get('view'));
  const view = calendarViewOf(pageView);
  const day = parseCalendarDate(url.searchParams.get('date'), todayIn(orgTz));
  const { from, to } = calendarLoadWindow(day, view, orgTz);

  // `?staff=`/`?kind=` only SEED the page's client-side filters (deep links and
  // bookmarks keep working); the window read is never narrowed by them, so
  // toggling a filter costs no round trip.
  const staffParam = url.searchParams.get('staff');
  const staff = staffParam ? staffParam.split(',').filter(Boolean) : [];
  const kindId = url.searchParams.get('kind');

  const activeResources = resources.filter((r) => r.active);
  const [eventTypes, kinds, schedules] = await Promise.all([
    listEventTypes(ctx),
    listEventKinds(ctx),
    Promise.all(activeResources.map((r) => getResourceSchedule(ctx, r.id))),
  ]);

  const { bookings, tagOptions } = await loadCalendarWindow(ctx, locals, {
    from,
    to,
    eventTypes,
    pos: false,
  });

  // The `category` colour source's VALUE list (previewed in the colour picker).
  // Fail-soft for the same reason POS's is: a missing POS module must never
  // cost the operator the calendar.
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

  return {
    day,
    view,
    pageView,
    staff,
    kindId,
    showInheritedTags,
    /** Event-scope registry + every tag present on a shown event — the filter's options. */
    tagOptions,
    bookings,
    resources: activeResources.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    hours,
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
      /** The service's assignees — the create tray's Team picker is limited to
       *  them, or forcing a non-assignee always answers 409. */
      resourceIds: e.resourceIds,
      /** Both are event-colour sources (see `booking-color.ts`). */
      color: e.color,
      kindId: e.kindId,
    })),
    /** Org event kinds with their colours — the `kind` colour source AND the
     *  toolbar's kind filter. */
    kinds: kinds.map((k) => ({ id: k.id, name: k.name, color: k.color, isDefault: k.isDefault })),
    /** `fin_product_categories` for the org — the `category` source's values. */
    categories: categories.map((c) => ({ name: c.name, color: c.color })),
  };
};
