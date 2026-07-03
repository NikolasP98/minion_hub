import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { publicBook } from '$server/services/scheduling-public.service';
import { SlotUnavailableError } from '$server/services/scheduling-bookings.service';

// Unauthenticated endpoint — validation here is the only trust boundary, so it's
// stricter than the internal booking route (bounded strings, real email format).
const publicBookSchema = z.object({
  eventTypeId: z.string().min(1).max(200),
  start: z
    .string()
    .min(1)
    .max(60)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'invalid start'),
  name: z.string().trim().min(1).max(200),
  // '' / null / undefined -> null (matches the old `b.email ? String(b.email) : null` guard).
  email: z.preprocess((v) => (v ? v : null), z.string().trim().toLowerCase().email().max(320).nullable().optional()),
  phone: z.preprocess((v) => (v ? v : null), z.string().trim().max(40).nullable().optional()),
  notes: z.preprocess((v) => (v ? v : null), z.string().max(2000).nullable().optional()),
});

/** Public, unauthenticated booking creation behind a scheduling-link slug. */
export const POST: RequestHandler = async ({ params, request }) => {
  const b = await parseBody(request, publicBookSchema);
  try {
    const booking = await publicBook(params.slug!, {
      eventTypeId: b.eventTypeId,
      start: b.start,
      name: b.name,
      email: b.email ?? null,
      phone: b.phone ?? null,
      notes: b.notes ?? null,
    });
    if (!booking) throw error(404, 'link or service not found');
    return json({ ok: true, uid: booking.uid, status: booking.status });
  } catch (e) {
    if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
    throw e;
  }
};
