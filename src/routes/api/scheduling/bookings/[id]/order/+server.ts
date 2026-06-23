import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { createOrderFromBooking } from '$server/services/sales.service';

/** POST /api/scheduling/bookings/:id/order — map a booking → Sales Order
 *  (idempotent: one order per booking). The Booking→Sales-Order document chain. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404);
  try {
    const order = await createOrderFromBooking(ctx, params.id!);
    return json(order, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'could not create order');
  }
};
