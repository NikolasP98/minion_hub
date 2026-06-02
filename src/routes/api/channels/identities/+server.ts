import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChannelIdentitiesForPicker } from '$server/services/channel-identity.service';
import { getTenantCtx } from '$server/auth/tenant-ctx';

/**
 * GET /api/channels/identities
 *
 * Org-wide list of user-linked channel identities (people who linked their
 * Telegram / WhatsApp / Discord / … account to a hub user). Powers the flow
 * editor's "Registered" destination picker — sending to a known user rather
 * than typing a raw address. Distinct from `channels.directory.list` (the
 * gateway bot's contacts) and from `/api/gateway/channel-identities` (the
 * gateway's startup fetch).
 */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');

  try {
    const rows = await listChannelIdentitiesForPicker(ctx);
    // Label preference: channel display name → hub user's name → raw channel id.
    const identities = rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      to: r.channelUserId,
      displayName: r.displayName?.trim() || r.userName?.trim() || null,
      verified: r.verifiedAt != null,
    }));
    return json({ identities });
  } catch (e) {
    console.error('[GET /api/channels/identities]', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
