import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { parseInclusiveEnd } from '$lib/components/dashboard/date-range/url';
import { createBookingResponse } from './_handlers';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const status = url.searchParams.get('status');
  const resourceId = url.searchParams.get('resourceId');
  const bookings = await listBookings(ctx, {
    from: from ? new Date(from) : undefined,
    // `to` is INCLUSIVE of the whole day — listBookings compares with `<=`, so a
    // date-only bound must be widened past midnight or that day vanishes.
    to: parseInclusiveEnd(to),
    status: status ? status.split(',') : undefined,
    resourceId: resourceId ?? undefined,
    maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
  });
  return json({ bookings });
};

/** Internal staff booking (on behalf of a customer). Bypasses min-notice. */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return createBookingResponse(ctx, locals, request);
};
