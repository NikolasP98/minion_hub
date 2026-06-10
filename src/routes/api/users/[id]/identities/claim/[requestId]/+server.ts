import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  getClaim,
  resolveTelegramDeepLink,
  attachChannelIdentitySupabase,
} from '$server/identity/channel-claim.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

/**
 * Poll a claim's status. For a Telegram deep-link claim still pending, this asks
 * the gateway whether the user has opened the link yet; once the gateway reports
 * the bound Telegram id, the identity is written to Supabase and the claim
 * resolves to `done`.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) throw error(401);
  if (!params.id || !params.requestId) throw error(400);
  if (locals.user.id !== params.id) throw error(403);

  const supabaseId = locals.user.supabaseId ?? locals.user.id;
  const claim = await getClaim({ supabaseId, requestId: params.requestId });

  if (claim.state === 'unknown') throw error(404, 'claim not found');
  if (claim.state === 'expired') return json({ status: 'expired' });
  if (claim.state === 'done') {
    // Already resolved+consumed; make sure the identity exists (idempotent).
    const attached = await attachChannelIdentitySupabase(supabaseId, {
      channel: claim.channel,
      channelUserId: claim.channelUserId,
      displayName: claim.displayName,
    });
    if (!attached.ok)
      return json({ status: attached.reason === 'taken' ? 'taken' : 'error' });
    return json({ status: 'done', channel: claim.channel, channelUserId: claim.channelUserId });
  }

  // pending — OTP claims complete via the confirm route, not here.
  if (claim.method !== 'deeplink' || !claim.token) return json({ status: 'pending' });

  let resolved: { status?: string; telegramUserId?: string; name?: string } | null = null;
  try {
    resolved = await gatewayCall('telegram.claimPoll', { token: claim.token });
  } catch {
    return json({ status: 'pending' }); // gateway hiccup — keep polling
  }
  if (resolved?.status !== 'resolved' || !resolved.telegramUserId) return json({ status: 'pending' });

  const bound = await resolveTelegramDeepLink({
    requestId: params.requestId,
    telegramUserId: resolved.telegramUserId,
    telegramName: resolved.name,
  });
  if (!bound.ok) return json({ status: 'pending' });

  const attached = await attachChannelIdentitySupabase(supabaseId, {
    channel: 'telegram',
    channelUserId: bound.channelUserId,
    displayName: bound.displayName,
  });
  if (!attached.ok) return json({ status: attached.reason === 'taken' ? 'taken' : 'error' });

  return json({ status: 'done', channel: 'telegram', channelUserId: bound.channelUserId });
};
