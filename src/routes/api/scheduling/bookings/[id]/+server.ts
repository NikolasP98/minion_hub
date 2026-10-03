import { requireSchedulingRead } from '$server/auth/scheduling-read';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  deleteBooking,
  BookingReferencedError,
} from '$server/services/scheduling-bookings.service';
import { bookingDetailResponse, patchBookingResponse } from '../_handlers';

/** GET /api/scheduling/bookings/[id] — the booking detail drawer's payload (§4.1). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireSchedulingRead(locals);
  return bookingDetailResponse(ctx, locals, params.id!);
};

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return patchBookingResponse(ctx, locals, request, params.id!);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  try {
    await deleteBooking(ctx, params.id!);
  } catch (e) {
    if (e instanceof BookingReferencedError) {
      return json({ error: 'referenced', references: e.references }, { status: 409 });
    }
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  return new Response(null, { status: 204 });
};
