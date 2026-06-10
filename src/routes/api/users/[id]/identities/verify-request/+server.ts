import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { requestOtpClaim } from '$server/identity/channel-claim.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

/**
 * Start an OTP claim: the hub generates a code (stored hashed in PG) and the
 * gateway delivers it to the target via its channel account. Used for WhatsApp
 * tier-1 claims. Telegram uses the deep-link flow (`./telegram/start`) instead,
 * since bots can't DM a user who hasn't messaged them first.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) throw error(401);
  if (!params.id) throw error(400);
  if (locals.user.id !== params.id) throw error(403, 'you can only claim your own identity');

  const b = (await request.json()) as { channel?: string; channelUserId?: string; displayName?: string };
  if (!b.channel || !b.channelUserId) throw error(400, 'channel + channelUserId required');
  if (b.channel === 'telegram') throw error(400, 'telegram claims use the deep-link flow');

  const supabaseId = locals.user.supabaseId ?? locals.user.id;
  const res = await requestOtpClaim({
    supabaseId,
    channel: b.channel,
    channelUserId: b.channelUserId,
    displayName: b.displayName,
  });
  if (!res.ok) {
    if (res.reason === 'cooldown')
      return json({ error: 'cooldown', retryAfterMs: res.retryAfterMs }, { status: 429 });
    if (res.reason === 'rate')
      return json({ error: 'rate_limited', retryAfterMs: res.retryAfterMs }, { status: 429 });
    throw error(400, 'could not start the claim');
  }

  try {
    await gatewayCall('channels.send', {
      channel: b.channel,
      to: res.channelUserId,
      text: `Your Minion verification code is ${res.code}\nIt expires in 10 minutes. Do not share it.`,
      idempotencyKey: randomUUID(),
    });
  } catch (e) {
    throw error(502, `could not send the code: ${e instanceof Error ? e.message : String(e)}`);
  }

  return json({ requestId: res.requestId, cooldownMs: res.cooldownMs });
};
