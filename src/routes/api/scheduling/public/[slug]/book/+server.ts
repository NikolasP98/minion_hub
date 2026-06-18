import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { publicBook } from '$server/services/scheduling-public.service';
import { SlotUnavailableError } from '$server/services/scheduling-bookings.service';

/** Public, unauthenticated booking creation behind a scheduling-link slug. */
export const POST: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.eventTypeId !== 'string' || typeof b.start !== 'string') throw error(400, 'eventTypeId and start required');
  if (typeof b.name !== 'string' || !b.name.trim()) throw error(400, 'name required');
  if (Number.isNaN(new Date(b.start).getTime())) throw error(400, 'invalid start');
  try {
    const booking = await publicBook(params.slug!, {
      eventTypeId: b.eventTypeId,
      start: b.start,
      name: String(b.name).trim(),
      email: b.email ? String(b.email) : null,
      phone: b.phone ? String(b.phone) : null,
      notes: b.notes ? String(b.notes) : null,
    });
    if (!booking) throw error(404, 'link or service not found');
    return json({ ok: true, uid: booking.uid, status: booking.status });
  } catch (e) {
    if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
    throw e;
  }
};
