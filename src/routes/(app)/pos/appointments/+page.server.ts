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
import { listPendingSchedulingLines } from '$server/services/pos-accounts.service';
import { loadPosCalendarWindow } from '$server/services/pos-calendar-window.service';
import {
  calendarLoadWindow,
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
  // The DATA-LOAD window is wider than the rendered view for workweek/week (4
  // ISO weeks, one behind the focused date) so infinite scrolling already has
  // a week loaded ahead/behind on first render (day view: unchanged, 1 day).
  const { from, to } = calendarLoadWindow(day, view, orgTz);

  const activeResources = resources.filter((r) => r.active);
  const [eventTypes, kinds, schedules] = await Promise.all([
    listEventTypes(ctx),
    listEventKinds(ctx),
    Promise.all(activeResources.map((r) => getResourceSchedule(ctx, r.id))),
  ]);

  const { bookings, invoices, accrualSummaries, tagOptions } = await loadPosCalendarWindow(
    ctx,
    locals,
    { from, to, eventTypes },
  );

  // The same column's VALUE list — previewed when the operator hovers the
  // `category` option in the calendar's colour picker. Fail-soft for the same
  // reason the colours in `loadPosCalendarWindow` are (a missing POS module
  // must not cost the grid).
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

  return {
    day,
    view,
    /** Event-scope registry + every tag present on a shown event — the filter's options. */
    tagOptions,
    bookings,
    invoices,
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
