import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { updateBookingNotes } from '$server/services/scheduling-bookings.service';
import { StaleWriteError } from '$server/services/errors';

// Both optional: the drawer saves one field at a time, and an absent key is
// "leave it alone" (an explicit null clears it).
const putSchema = z
  .object({
    notes: z.string().max(20_000).nullable().optional(),
    clientNote: z.string().max(20_000).nullable().optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .refine((b) => 'notes' in b || 'clientNote' in b, { message: 'notes or clientNote is required' });

/** PUT /api/scheduling/bookings/[id]/notes — internal note + client-visible note (§4.1). */
export const PUT: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const { expectedUpdatedAt, ...b } = await parseBody(request, putSchema);
  try {
    const booking = await updateBookingNotes(ctx, params.id!, b, expectedUpdatedAt);
    if (!booking) throw error(404, 'booking not found');
    return json({ booking });
  } catch (e) {
    if (e instanceof StaleWriteError)
      return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};
