import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { createOrderFromBooking } from '$server/services/sales.service';

const bodySchema = z.object({ bookingId: z.string().min(1) });

/**
 * POST /api/sales/orders/from-booking — map a booking → Sales Order
 * (idempotent: one order per booking). The Booking→Sales-Order document chain.
 *
 * Lives under /api/sales, NOT /api/scheduling, because the write it performs is
 * a SALES write: `apiWriteCapability` resolves the required capability from the
 * URL prefix, so the old `/api/scheduling/bookings/:id/order` path bought this
 * with `scheduling:edit` and never consulted the sales module at all. The
 * booking id rides the body now that it is no longer a path param.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404);
  const { bookingId } = await parseBody(request, bodySchema);
  try {
    const order = await createOrderFromBooking(ctx, bookingId);
    return json(order, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'could not create order');
  }
};
