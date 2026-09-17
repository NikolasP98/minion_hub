import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { publicBook } from '$server/services/scheduling-public.service';
import { SlotUnavailableError } from '$server/services/scheduling-bookings.service';
import { checkRateLimit } from '$server/auth/rate-limit';

// Unauthenticated, unlimited write otherwise: every booking inserts a CRM
// contact (ensureCrmContact) per new phone/email, so an unthrottled caller
// could flood a tenant's CRM. Keyed on IP + slug so hammering one link
// doesn't also lock out bookings on a different link from the same NAT'd IP.
const PUBLIC_BOOK_LIMIT = 10;

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
  email: z.preprocess(
    (v) => (v ? v : null),
    z.string().trim().toLowerCase().email().max(320).nullable().optional(),
  ),
  phone: z.preprocess((v) => (v ? v : null), z.string().trim().max(40).nullable().optional()),
  notes: z.preprocess((v) => (v ? v : null), z.string().max(2000).nullable().optional()),
});

/** Public, unauthenticated booking creation behind a scheduling-link slug. */
export const POST: RequestHandler = async (event) => {
  const { params, request } = event;
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`public-book:${ip}:${params.slug}`, PUBLIC_BOOK_LIMIT)) {
    throw error(
      429,
      'Too many booking attempts from this address — please wait a minute and try again.',
    );
  }
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
