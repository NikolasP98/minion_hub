import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { setBookingStatus, getBooking } from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';

// Mirrors SETTABLE in scheduling-bookings.service.ts.
const patchSchema = z.object({
  status: z.enum(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show']),
});

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  try {
    await setBookingStatus(ctx, params.id!, b.status);
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: { code: string; message: string; draftEntryId?: string } | null = null;
  if (b.status === 'completed') {
    try {
      const booking = await getBooking(ctx, params.id!);
      const r = await realizeAccruals(ctx, {
        source: 'booking',
        sourceId: params.id!,
        finProductId: booking?.productId ?? null,
        partyId: booking?.partyId ?? null,
        note: booking ? `Booking: ${booking.title}` : null,
        actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
      });
      stockWarning = r.stockWarning;
    } catch (e) {
      stockWarning = { code: 'realize_failed', message: e instanceof Error ? e.message : 'stock realize failed' };
    }
  }
  return json({ ok: true, stockWarning });
};
