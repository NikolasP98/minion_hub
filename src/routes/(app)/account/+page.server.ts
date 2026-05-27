import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listIdentities } from '$server/services/identity.service';
import { listOAuthIdentitiesFromSupabase } from '$server/services/supabase-credential';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:identities');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');

  // Channels (kind='channel') still live in the Turso identity store.
  const tursoRows = await listIdentities(locals.tenantCtx, locals.user.id);
  const channelIdentities = tursoRows
    .filter((i) => i.kind === 'channel')
    .map((i) => ({
      id: i.id,
      source: 'turso' as const,
      provider: i.provider,
      kind: 'channel' as const,
      externalId: i.externalId,
      displayName: i.displayName,
      verifiedAt: i.verifiedAt,
    }));

  // OAuth identities come from the canonical Supabase vault, where a Google
  // login is auto-linked on every sign-in (see syncGoogleLogin). The supabase
  // uuid is the profile/user_identities key.
  const supabaseId = locals.user.supabaseId ?? locals.user.id;
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
