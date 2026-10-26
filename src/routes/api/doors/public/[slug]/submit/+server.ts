import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { checkRateLimit } from '$server/auth/rate-limit';
import { submitFormDoor } from '$server/services/doors-form.service';
import { attributionSchema } from '$lib/doors/attribution';

// Unauthenticated write of personal (possibly clinical) data. This handler is
// the trust boundary: the body is re-validated against the door's stored
// config, and no response, log line or error ever carries a submitted value.
// shortcut: the limiter is per lambda (rate-limit.ts), same as /book; move to Valkey if abuse shows.
const SUBMIT_LIMIT = 5;

const bodySchema = z
  .object({
    values: z.record(z.string().max(40), z.unknown()),
    consent: z.boolean().optional().default(false),
    website: z.string().max(500).optional(),
    attribution: attributionSchema.optional(),
  })
  .strip();

const fail = (status: number, code: string) => json({ error: code }, { status });

/** POST /api/doors/public/[slug]/submit — public form door submission. */
export const POST: RequestHandler = async (event) => {
  const { params, request } = event;
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`door-submit:${ip}:${params.slug}`, SUBMIT_LIMIT))
    return fail(429, 'too_many');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, 'invalid_body');
  }
  // Honeypot: a hidden field only bots fill. Pretend success, store nothing.
  const hp = (raw as { website?: unknown } | null)?.website;
  if (typeof hp === 'string' && hp.trim()) return json({ ok: true, message: null });

  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail(400, 'invalid_body');

  try {
    const result = await submitFormDoor(params.slug ?? '', {
      values: body.data.values,
      consent: body.data.consent,
      attribution: body.data.attribution,
    });
    if (result.status === 'not_found') return fail(404, 'not_found');
    if (result.status === 'invalid')
      return json({ error: 'invalid', fields: result.errors }, { status: 400 });
    return json({ ok: true, message: result.message });
  } catch (e) {
    // Driver errors can quote the query parameters (the patient's answers): log the code only.
    const code = (e as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};
    console.error(
      '[doors] form submit failed',
      params.slug,
      code.code ?? code.cause?.code ?? 'error',
    );
    return fail(500, 'server_error');
  }
};
