import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { requireModuleEnabled } from '$server/http/require-module';
import { getBooking } from '$server/services/scheduling-bookings.service';
import { accrueConsumption } from '$server/services/stock-accruals.service';

const postSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() }))
    .min(1),
});

/** POST /api/scheduling/bookings/[id]/accrual { lines } — replace the booking's
 *  open expected-consumption set before completion (settled sources no-op). */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'scheduling');
  await requireModuleEnabled(ctx, 'stock');
  const b = await parseBody(request, postSchema);
  const booking = await getBooking(ctx, params.id!);
  if (!booking) throw error(404, 'booking not found');
  const accrued = await accrueConsumption(ctx, {
    source: 'booking',
    sourceId: params.id!,
    finProductId: booking.productId ?? null,
    lines: b.lines,
  });
  return json({ accrued });
};
