import { mapGoogleIdentity, type GoTrueUserLike } from '@minion-stack/db/pg';

type Sealer = (plaintext: string) => { ciphertext: string; iv: string };

interface SupabaseAdminLike {
  from(table: string): {
    // Supabase's upsert returns a thenable builder; it only executes when awaited.
    upsert(row: unknown, opts?: unknown): PromiseLike<{ error: unknown }>;
  };
}

export interface GoogleLoginContext {
  user: GoTrueUserLike;
  providerRefreshToken: string | null;
  providerScope: string | null;
}

/**
 * Ensure canonical profile + google user_identities rows after OAuth login.
 * RLS-bypassing admin client + a sealer injected for testability.
 */
export async function syncGoogleLogin(
  admin: SupabaseAdminLike,
  seal: Sealer,
  ctx: GoogleLoginContext,
): Promise<void> {
  const { profile, identity } = mapGoogleIdentity(ctx.user, {
    refreshToken: ctx.providerRefreshToken,
    scope: ctx.providerScope,
  });

  const now = new Date().toISOString();

  const profileRes = await admin.from('profiles').upsert(
    { id: profile.id, email: profile.email, display_name: profile.displayName, updated_at: now },
    { onConflict: 'id' },
  );
  if (profileRes.error) throw new Error(`profile upsert failed: ${String(profileRes.error)}`);

  let secret_ciphertext: string | null = null;
  let secret_iv: string | null = null;
  if (identity.hasSecret && ctx.providerRefreshToken) {
    const blob = JSON.stringify({ type: 'authorized_user', refresh_token: ctx.providerRefreshToken });
    const sealed = seal(blob);
    secret_ciphertext = sealed.ciphertext;
    secret_iv = sealed.iv;
  }

  const identityRes = await admin.from('user_identities').upsert(
    {
      user_id: identity.userId,
      provider: identity.provider,
      kind: identity.kind,
      external_id: identity.externalId,
      display_name: identity.displayName,
      scope: identity.scope,
      secret_ciphertext,
      secret_iv,
      verified_at: Date.now(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider,external_id' },
  );
  if (identityRes.error) throw new Error(`identity upsert failed: ${String(identityRes.error)}`);
}
