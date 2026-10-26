import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { checkRateLimit } from '$server/auth/rate-limit';
import { bumpDoorStat, resolvePublicDoor } from '$server/services/doors.service';

// Anonymous click beacon for offer doors. Counts only; nothing about the visitor is stored.
// shortcut: per-lambda limiter (the form door uses the shared one); counts are approximate by design.
const CLICK_LIMIT = 30;
const bodySchema = z.object({ kind: z.enum(['whatsapp', 'book']) }).strip();

/** POST /api/doors/public/[slug]/click — +1 click on a live offer door. */
export const POST: RequestHandler = async (event) => {
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  const slug = event.params.slug ?? '';
  if (!checkRateLimit(`door-click:${ip}:${slug}`, CLICK_LIMIT))
    return json({ error: 'too_many' }, { status: 429 });
  // sendBeacon posts text/plain: parse the text, not the content type.
  let raw: unknown;
  try {
    raw = JSON.parse(await event.request.text());
  } catch {
    return json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!bodySchema.safeParse(raw).success) return json({ error: 'invalid_body' }, { status: 400 });
  const resolved = await resolvePublicDoor(slug);
  if (!resolved || resolved.door.kind !== 'offer')
    return json({ error: 'not_found' }, { status: 404 });
  await bumpDoorStat(resolved.ctx, `door:${resolved.door.id}`, 'clicks');
  return new Response(null, { status: 204 });
};
