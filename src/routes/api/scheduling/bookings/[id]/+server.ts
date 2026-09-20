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
// TODO(handoff): this read now returns package-grant money, plan money and an
// actor display name, but still gates on module-enabled + PII masking rather
// than an explicit `requireOrgCapability(locals, 'scheduling', 'view')` — the
// older scheduling convention. Moving it is a behaviour change for roles that
// hold the module but not the capability, so it belongs to a sweep of ALL
// scheduling reads, not to this one route. See meta
// proposals/2026-09-13-pos-packages-plans-s1-followups.md §27.
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
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
