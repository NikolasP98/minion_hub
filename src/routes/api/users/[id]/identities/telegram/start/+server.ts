import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { startTelegramDeepLink } from '$server/identity/channel-claim.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

/**
 * Begin a Telegram claim via deep link. The hub mints an opaque start token,
 * arms it on the gateway (which returns the configured bot's username), and hands
 * back a `t.me/<bot>?start=<token>` link. When the user opens it and the bot
 * receives `/start <token>`, the gateway binds their Telegram id; the client
 * polls `../claim/[requestId]` to finish.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) throw error(401);
  if (!params.id) throw error(400);
  if (locals.user.id !== params.id) throw error(403, 'you can only claim your own identity');

  const b = (await request.json().catch(() => ({}))) as { displayName?: string };
  const supabaseId = locals.user.supabaseId ?? locals.user.id;

  const res = await startTelegramDeepLink({ supabaseId, displayName: b.displayName });
  if (!res.ok) {
    if (res.reason === 'rate') return json({ error: 'rate_limited' }, { status: 429 });
    throw error(400, 'could not start the claim');
  }

  let botUsername: string;
  try {
    const armed = await gatewayCall<{ botUsername?: string }>('telegram.claimArm', { token: res.token });
    if (!armed?.botUsername) throw new Error('gateway returned no bot username');
    botUsername = armed.botUsername.replace(/^@/, '');
  } catch (e) {
    throw error(502, `telegram is not available on this gateway: ${e instanceof Error ? e.message : String(e)}`);
  }

  const deepLink = `https://t.me/${botUsername}?start=${res.token}`;
  return json({ requestId: res.requestId, deepLink, botUsername });
};
