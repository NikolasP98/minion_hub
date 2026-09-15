import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  createBookingSeries,
  MAX_SERIES_SLOTS,
  SlotUnavailableError,
} from '$server/services/scheduling-bookings.service';
import { rethrowPosError } from '../../_errors';

const postSchema = z.object({
  eventTypeId: z.string().min(1).max(200),
  /** One start instant per occurrence; the service sorts them and assigns
   *  series_index in chronological order. */
  slots: z.array(z.coerce.date()).min(1).max(MAX_SERIES_SLOTS),
  attendeeName: z.string().max(500).nullable().optional(),
  attendeeEmail: z.string().max(500).nullable().optional(),
  attendeePhone: z.string().max(500).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  clientNote: z.string().max(20_000).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  resourceId: z.string().max(200).nullable().optional(),
  packageGrantId: z.string().uuid().nullable().optional(),
  paymentPlanId: z.string().uuid().nullable().optional(),
  consumption: z
    .array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() }))
    .nullable()
    .optional(),
});

/**
 * POST /api/scheduling/bookings/series — book a whole course at once (spec §3.3).
 * All-or-nothing: one unavailable slot or one session too few on the grant and
 * NOTHING is created.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, postSchema);
  try {
    const bookings = await createBookingSeries(ctx, {
      eventTypeId: b.eventTypeId,
      slots: b.slots,
      attendeeName: b.attendeeName ?? null,
      attendeeEmail: b.attendeeEmail ?? null,
      attendeePhone: b.attendeePhone ?? null,
      notes: b.notes ?? null,
      clientNote: b.clientNote ?? null,
      crmContactId: b.crmContactId ?? null,
      preferredResourceId: b.resourceId ?? null,
      source: 'internal',
      bypassRules: true,
      consumption: b.consumption ?? null,
      packageGrantId: b.packageGrantId ?? null,
      paymentPlanId: b.paymentPlanId ?? null,
      actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
    });
    return json({ bookings, seriesId: bookings[0]?.seriesId ?? null });
  } catch (e) {
    if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
    rethrowPosError(e);
  }
};
