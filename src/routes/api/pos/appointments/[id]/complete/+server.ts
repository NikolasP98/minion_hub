import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { completeBookingResponse } from '../../../../scheduling/bookings/_handlers';

/**
 * POST /api/pos/appointments/[id]/complete — the scheduling handler under the
 * POS path: the central gate maps `/api/pos` writes to `pos:edit`, so a
 * cashier can close an appointment from the POS calendar without a scheduling
 * role. Same body, response and module check (scheduling) as the scheduling route.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return completeBookingResponse(ctx, locals, request, params.id!, 'pos');
};
