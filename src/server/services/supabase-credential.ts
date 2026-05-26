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
