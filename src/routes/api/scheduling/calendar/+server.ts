import { requireSchedulingRead } from '$server/auth/scheduling-read';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { datasetCtx } from '$server/auth/dataset-ctx';
import { requireProductsVersion } from '$server/api/booking-products-version';
import { loadCalendarWindow } from '$server/services/calendar-window.service';
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';
import {
  calendarWindowScope,
  schedulingTimeZone,
} from '$lib/components/scheduling/calendar-window';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 62;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/scheduling/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — a day-range
 * slice of the calendar window, for the client to fetch additional weeks as it
 * scrolls past what the SSR load already covered. Twin of
 * `GET /api/pos/appointments` on the same `loadCalendarWindow` read, with the
 * `scheduling` gate and `pos: false` (no tickets, no accrual chips).
 *
 * Since spec 2026-09-27 S3 the bounds are calendar DAYS (`YYYY-MM-DD`), not ISO
 * instants: the window-cache kit asks for whole ISO weeks and the org's business
 * timezone — not UTC — decides where a day starts, exactly like the POS twin.
 */
export const GET: RequestHandler = async ({ locals, url, request }) => {
  const ctx = await requireSchedulingRead(locals);
  const stale = requireProductsVersion(request);
  if (stale) return stale;

  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  if (!fromRaw || !toRaw) throw error(400, 'from and to are required');
  if (!DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) {
    throw error(400, 'from and to must be YYYY-MM-DD');
  }
  if (toRaw < fromRaw) throw error(400, 'to must not be before from');
  const rangeDays =
    (Date.parse(`${toRaw}T00:00:00Z`) - Date.parse(`${fromRaw}T00:00:00Z`)) / DAY_MS + 1;
  if (rangeDays > MAX_RANGE_DAYS) throw error(400, `range must be at most ${MAX_RANGE_DAYS} days`);

  const resources = await listResources(ctx);
  const orgTz = schedulingTimeZone(resources);
  const window = zonedDayWindow(fromRaw, toRaw, orgTz);
  const from = window.from!;
  const to = new Date(window.to!.getTime() - 1);

  const eventTypes = await listEventTypes(ctx);
  const payload = await loadCalendarWindow(ctx, locals, {
    from,
    to,
    eventTypes,
    pos: false,
    // Tags/colours through their own handles (denied = degraded); no pos/stock facets on this host.
    foreign: {
      pos: await datasetCtx(locals, 'pos'),
      crm: await datasetCtx(locals, 'crm'),
    },
  });
  return json({ calendarScope: calendarWindowScope(ctx.tenantId, orgTz), ...payload });
};
