import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
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
  });
  return json({ bookings });
};

/** Internal staff booking (on behalf of a customer). Bypasses min-notice. */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.eventTypeId !== 'string' || typeof b.start !== 'string') throw error(400, 'eventTypeId and start required');
  const start = new Date(b.start);
  if (Number.isNaN(start.getTime())) throw error(400, 'invalid start');
  try {
    const booking = await createBooking(ctx, {
      eventTypeId: b.eventTypeId,
      start,
      attendeeName: b.attendeeName ? String(b.attendeeName) : null,
      attendeeEmail: b.attendeeEmail ? String(b.attendeeEmail) : null,
      attendeePhone: b.attendeePhone ? String(b.attendeePhone) : null,
      notes: b.notes ? String(b.notes) : null,
      preferredResourceId: b.resourceId ? String(b.resourceId) : null,
      source: 'internal',
      bypassRules: true,
    });
    return json({ booking });
  } catch (e) {
    if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
    throw e;
  }
};
