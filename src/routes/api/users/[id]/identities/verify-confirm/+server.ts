import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { verifyOtpClaim, attachChannelIdentitySupabase } from '$server/identity/channel-claim.service';

/**
 * Confirm an OTP claim: verify the code, then write the verified channel identity
 * into the canonical Supabase `user_identities` vault. The `(provider, external_id)`
 * unique index guarantees one target → one hub user (409 on a cross-user clash).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) throw error(401);
  if (!params.id) throw error(400);
  if (locals.user.id !== params.id) throw error(403, 'you can only claim your own identity');

  const b = (await request.json()) as { requestId?: string; code?: string };
  if (!b.requestId || !b.code) throw error(400, 'requestId + code required');

  const supabaseId = locals.user.supabaseId ?? locals.user.id;
  const result = await verifyOtpClaim({ supabaseId, requestId: b.requestId, code: b.code });
  if (!result.ok) {
    const status = result.reason === 'attempts' ? 429 : 400;
    throw error(status, `code ${result.reason}`);
  }

  const attached = await attachChannelIdentitySupabase(supabaseId, {
    channel: result.channel,
    channelUserId: result.channelUserId,
    displayName: result.displayName,
  });
  if (!attached.ok) {
    if (attached.reason === 'taken') throw error(409, 'this number is already claimed by another account');
    throw error(500, 'could not save identity');
  }
  return json({ ok: true, id: attached.id });
};
