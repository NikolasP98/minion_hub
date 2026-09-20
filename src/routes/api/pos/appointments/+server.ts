import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { createBookingResponse } from '../../scheduling/bookings/_handlers';

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
