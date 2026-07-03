import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { listBookings, createBooking, SlotUnavailableError } from '$server/services/scheduling-bookings.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const status = url.searchParams.get('status');
  const resourceId = url.searchParams.get('resourceId');
  const bookings = await listBookings(ctx, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    status: status ? status.split(',') : undefined,
    resourceId: resourceId ?? undefined,
    maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
  });
  return json({ bookings });
};

const postSchema = z.object({
  eventTypeId: z.string().min(1).max(200),
  start: z.coerce.date(),
  attendeeName: z.string().max(500).nullable().optional(),
  attendeeEmail: z.string().max(500).nullable().optional(),
  attendeePhone: z.string().max(500).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  crmContactId: z.string().max(200).nullable().optional(),
  resourceId: z.string().max(200).nullable().optional(),
});

/** Internal staff booking (on behalf of a customer). Bypasses min-notice. */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, postSchema);
  try {
    const booking = await createBooking(ctx, {
      eventTypeId: b.eventTypeId,
      start: b.start,
      attendeeName: b.attendeeName ?? null,
      attendeeEmail: b.attendeeEmail ?? null,
      attendeePhone: b.attendeePhone ?? null,
      notes: b.notes ?? null,
      crmContactId: b.crmContactId ?? null,
      preferredResourceId: b.resourceId ?? null,
      source: 'internal',
      bypassRules: true,
    });
    return json({ booking });
  } catch (e) {
    if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
    throw e;
  }
};
