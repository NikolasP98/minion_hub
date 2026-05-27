import { supabaseAdmin } from '$server/supabase';
import { openSecret } from '@minion-stack/db/pg';
import { env } from '$env/dynamic/private';
import type { GoogleAdc } from './identity-secrets';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a user's Google credential from the canonical Supabase
 * `user_identities` vault.
 *
 * The gateway passes the legacy Better Auth user id (resolved from
 * channel_identities); the hub UI may pass the Supabase profile uuid. We map
 * either to a `profiles` row, then read that user's google identity. The sealed
 * blob holds only the refresh_token — client_id/secret come from the OAuth app
 * env (same Google client used for login). Decryption uses the shared
 * ENCRYPTION_KEY (openSecret), so the sealed token must have been written by a
 * service sharing that key (hub/site, which they do).
 *
 * Returns null when the user has no linked, secret-bearing google identity, so
 * the caller can fall back to the legacy Turso vault.
 */
export async function getGoogleCredentialFromSupabase(
  userId: string,
): Promise<{ email: string; adc: GoogleAdc } | null> {
  const admin = supabaseAdmin();

  // Map legacy id (gateway) OR supabase uuid (hub) -> profile id. Avoid
  // comparing a non-uuid against the uuid `id` column (Postgres would throw).
  let profileId: string | null = null;
  const byLegacy = await admin
    .from('profiles')
    .select('id')
    .eq('legacy_user_id', userId)
    .maybeSingle();
  profileId = byLegacy.data?.id ?? null;
  if (!profileId && UUID_RE.test(userId)) {
    const byId = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
    profileId = byId.data?.id ?? null;
  }
  if (!profileId) return null;

  const { data: identity } = await admin
    .from('user_identities')
    .select('external_id, secret_ciphertext, secret_iv')
    .eq('user_id', profileId)
    .eq('provider', 'google')
    .maybeSingle();
  if (!identity?.secret_ciphertext || !identity?.secret_iv) return null;

  let refreshToken: string | undefined;
  try {
    const blob = JSON.parse(openSecret(identity.secret_ciphertext, identity.secret_iv)) as {
      refresh_token?: string;
    };
    refreshToken = blob.refresh_token;
  } catch {
    return null; // undecryptable (key mismatch) — let caller fall back
  }
  if (!refreshToken) return null;

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return {
    email: identity.external_id,
    adc: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      type: 'authorized_user',
    },
  };
}

/** Map a hub user id (legacy_user_id) OR supabase uuid -> profile id. */
async function resolveProfileId(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
): Promise<string | null> {
  const byLegacy = await admin
    .from('profiles')
    .select('id')
    .eq('legacy_user_id', userId)
    .maybeSingle();
  if (byLegacy.data?.id) return byLegacy.data.id;
  if (UUID_RE.test(userId)) {
    const byId = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (byId.data?.id) return byId.data.id;
  }
  return null;
}

export type SupabaseOAuthIdentity = {
  id: string;
  provider: string;
  externalId: string;
  displayName: string | null;
  verifiedAt: number | null;
};

/**
 * List a user's OAuth identities (kind='oauth') from the canonical Supabase
 * `user_identities` vault — where {@link syncGoogleLogin} auto-writes the
 * Google identity on every OAuth login. This is the source of truth for the
 * account page's "Connected Accounts" so a Google login appears automatically,
 * with no manual re-link/confirm step.
 *
 * Accepts the hub user id (legacy_user_id) or a supabase uuid. Returns an empty
 * array (never throws) when Supabase is unreachable or the user has no profile,
 * so the account page degrades gracefully in local/dev.
 */
export async function listOAuthIdentitiesFromSupabase(
  userId: string,
): Promise<SupabaseOAuthIdentity[]> {
  try {
    const admin = supabaseAdmin();
    const profileId = await resolveProfileId(admin, userId);
    if (!profileId) return [];

    const { data, error } = await admin
      .from('user_identities')
      .select('id, provider, external_id, display_name, verified_at')
      .eq('user_id', profileId)
      .eq('kind', 'oauth');
    if (error || !data) return [];

    return data.map((r) => ({
      id: r.id as string,
      provider: r.provider as string,
      externalId: r.external_id as string,
      displayName: (r.display_name as string | null) ?? null,
      verifiedAt: r.verified_at == null ? null : Number(r.verified_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Unlink an OAuth identity from the Supabase vault. Scoped to the resolved
 * profile so a user can only remove their own identity. Returns true on
 * success.
 */
export async function deleteOAuthIdentityFromSupabase(
  userId: string,
  identityId: string,
): Promise<boolean> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, userId);
  if (!profileId) return false;

  const { error } = await admin
    .from('user_identities')
    .delete()
    .eq('user_id', profileId)
    .eq('id', identityId);
  return !error;
}

/**
 * Update the current user's own canonical Supabase profile. Keyed by the
 * supabase uuid (profiles.id). Only the fields present in `patch` are written.
 * Returns true on success.
 */
export async function updateSupabaseProfile(
  supabaseId: string,
  patch: { displayName?: string | null; avatarUrl?: string | null },
): Promise<boolean> {
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) set.display_name = patch.displayName;
  if (patch.avatarUrl !== undefined) set.avatar_url = patch.avatarUrl;

  const { error } = await supabaseAdmin().from('profiles').update(set).eq('id', supabaseId);
  return !error;
}
