import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getBooking, setBookingStatus } from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';

const postSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().positive(),
        qtyConsumption: z.number().positive().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  warehouseId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/scheduling/bookings/[id]/complete { lines?, warehouseId? }
 * Two deliberate steps, not one tx (submitEntry owns its own tx): (1) status →
 * completed — the business fact commits first; (2) realize the accrued stock.
 * A short bin never blocks completion: the response carries stockWarning and a
 * re-POST retries the realize alone (idempotent — the draft entry is reused).
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, postSchema);

  const booking = await getBooking(ctx, params.id!);
  if (!booking) throw error(404, 'booking not found');
  if (['cancelled', 'rejected'].includes(booking.status)) throw error(400, `booking is ${booking.status}`);

  if (booking.status !== 'completed') await setBookingStatus(ctx, params.id!, 'completed');

  try {
    const r = await realizeAccruals(ctx, {
      source: 'booking',
      sourceId: params.id!,
      lines: b.lines ?? null,
      warehouseId: b.warehouseId ?? null,
      finProductId: booking.productId ?? null,
      partyId: booking.partyId ?? null,
      note: `Booking: ${booking.title}`,
      actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
    });
    return json({ ok: true, entryId: r.entry?.id ?? null, stockWarning: r.stockWarning });
  } catch (e) {
    return json({
      ok: true,
      entryId: null,
      stockWarning: { code: 'realize_failed', message: e instanceof Error ? e.message : 'stock realize failed' },
    });
  }
};
