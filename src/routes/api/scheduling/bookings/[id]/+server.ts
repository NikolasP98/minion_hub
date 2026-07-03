import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { setBookingStatus } from '$server/services/scheduling-bookings.service';

// Mirrors SETTABLE in scheduling-bookings.service.ts.
const patchSchema = z.object({
  status: z.enum(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show']),
});

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  try {
    await setBookingStatus(ctx, params.id!, b.status);
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  return json({ ok: true });
};
