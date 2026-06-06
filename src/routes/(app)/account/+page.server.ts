import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
  listOAuthIdentitiesFromSupabase,
  listChannelIdentitiesFromSupabase,
} from '$server/services/supabase-credential';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:identities');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');

  const supabaseId = locals.user.supabaseId ?? locals.user.id;

  // Both channel and OAuth identities come from the canonical Supabase vault
  // (keyed by profile uuid). A Google login is auto-linked on every sign-in
  // (see syncGoogleLogin); channel identities are linked via the gateway.
  const channelRows = await listChannelIdentitiesFromSupabase(supabaseId);
  const channelIdentities = channelRows.map((i) => ({
    id: i.id,
    source: 'supabase' as const,
    provider: i.channel,
    kind: 'channel' as const,
    externalId: i.channelUserId,
    displayName: i.displayName,
    verifiedAt: i.verifiedAt,
  }));

  const oauthRows = await listOAuthIdentitiesFromSupabase(supabaseId);
  const oauthIdentities = oauthRows.map((i) => ({
    id: i.id,
    source: 'supabase' as const,
    provider: i.provider,
    kind: 'oauth' as const,
    externalId: i.externalId,
    displayName: i.displayName,
    verifiedAt: i.verifiedAt,
  }));

  return {
    userId: locals.user.id,
    identities: [...oauthIdentities, ...channelIdentities],
  };
};
