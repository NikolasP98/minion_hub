import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { loadPosCalendarWindow } from '$server/services/pos-calendar-window.service';
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';
import { createBookingResponse } from '../../scheduling/bookings/_handlers';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 62;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/pos/appointments — book an appointment from the POS calendar with
 * POS capabilities (`pos:create`, central gate — this path is in
 * CREATE_COLLECTION_ENDPOINTS). Same body and behaviour as
 * `POST /api/scheduling/bookings`; the difference is only WHO may call it: a
 * cashier who schedules before charging must not need a scheduling role.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  return createBookingResponse(ctx, locals, request);
};

/**
 * GET /api/pos/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD — a day-range slice
 * of the calendar window (`loadPosCalendarWindow`), for the client to fetch
 * additional weeks as it scrolls past what the SSR load already covered
 * (`calendarLoadWindow` in the page load). Same shape the page's own load
 * returns for `bookings`/`invoices`/`accrualSummaries`/`tagOptions`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  // Read gate matching the RBAC checklist (POST/PATCH are gated centrally by
  // `apiWriteCapability`; this is the matching read gate — see
  // /api/pos/appointments/[id] and /api/pos/accounts for the same pattern).
  await requireOrgCapability(locals, 'pos', 'view');

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

  // The org timezone rides on the resources, exactly like the page load — the
  // two calendars (and this endpoint) must resolve the SAME window for the
  // same from/to.
  const resources = await listResources(ctx);
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';
  const window = zonedDayWindow(fromRaw, toRaw, orgTz);
  const from = window.from!;
  const to = new Date(window.to!.getTime() - 1);

  const eventTypes = await listEventTypes(ctx);
  const payload = await loadPosCalendarWindow(ctx, locals, { from, to, eventTypes });
  return json(payload);
};
