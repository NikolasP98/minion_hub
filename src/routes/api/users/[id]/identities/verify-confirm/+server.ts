import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { consumeOtp } from '$server/identity/otp-store';
import { attachIdentity } from '$server/services/identity.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!params.id) throw error(400);
  const b = (await request.json()) as { requestId?: string; code?: string };
  if (!b.requestId || !b.code) throw error(400);

  const result = consumeOtp(b.requestId, b.code);
  if (!result.ok) throw error(400, `code ${result.reason}`);
  if (result.userId !== params.id) throw error(403, 'request user mismatch');

  try {
    const id = await attachIdentity(locals.tenantCtx, params.id, {
      channel: result.channel,
      channelUserId: result.channelUserId,
      verified: true,
    });
    return json({ ok: true, id });
  } catch (e) {
    if (/UNIQUE|duplicate/i.test(String(e))) throw error(409, 'identity already linked');
    throw error(500);
  }
};
