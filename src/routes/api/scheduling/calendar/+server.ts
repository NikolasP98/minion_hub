import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { loadCalendarWindow } from '$server/services/calendar-window.service';
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';

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
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  // Read gate matching the page's own (`scheduling.calendar:view` via the (app)
  // guard) and the POS twin's — the writes are gated centrally.
  await requireOrgCapability(locals, 'scheduling', 'view');

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
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';
  const window = zonedDayWindow(fromRaw, toRaw, orgTz);
  const from = window.from!;
  const to = new Date(window.to!.getTime() - 1);

  const eventTypes = await listEventTypes(ctx);
  const { bookings, tagOptions } = await loadCalendarWindow(ctx, locals, {
    from,
    to,
    eventTypes,
    pos: false,
  });
  return json({ bookings, tagOptions });
};
