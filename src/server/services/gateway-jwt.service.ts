import { eq } from 'drizzle-orm';
import { SignJWT, importJWK, exportJWK, generateKeyPair, type JWK } from 'jose';
import { userAgents } from '@minion-stack/db/schema';
import { sealSecret, openSecret } from '@minion-stack/db/pg';
import { supabaseAdmin } from '$server/supabase';
import { env } from '$env/dynamic/private';
import type { TenantContext } from './base';

/** Claims included in the gateway JWT payload. */
export interface GatewayJwtClaims {
  userId: string;
  role: 'admin' | 'user';
  agentIds: string[];
  orgId: string | null;
}

/** JWT expiration time in seconds (1 hour). */
const JWT_EXPIRY_SECONDS = 3600;
const ALG = 'EdDSA';

/**
 * Stable issuer for the gateway JWT. Must match the gateway's configured
 * `oidcIssuers` entry AND the origin from which `/.well-known/openid-configuration`
 * is fetched. Kept as `BETTER_AUTH_URL` (unchanged) so the gateway keeps
 * validating across the Better Auth removal; override via `GATEWAY_JWT_ISSUER`.
 */
export function gatewayJwtIssuer(): string {
  return env.GATEWAY_JWT_ISSUER ?? env.BETTER_AUTH_URL ?? 'http://localhost:5173';
}

interface SigningKey {
  kid: string;
  alg: string;
  privateKey: Awaited<ReturnType<typeof importJWK>>;
  publicJwk: JWK;
}

interface SigningKeyRow {
  kid: string;
  alg: string;
  public_jwk: JWK;
  private_ciphertext: string;
  private_iv: string;
}

/**
 * Load the active standalone signing key, generating + persisting one on first
 * use. The private JWK is sealed with `ENCRYPTION_KEY` (NOT `BETTER_AUTH_SECRET`).
 *
 * Concurrency: a cold-start race before any key exists may insert more than one
 * row — harmless, because `/.well-known/jwks.json` serves *all* public keys, so a
 * token signed with any of them validates. After the first key persists, every
 * caller finds + reuses it.
 */
async function loadActiveSigningKey(): Promise<SigningKey> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('gateway_signing_keys')
    .select('kid, alg, public_jwk, private_ciphertext, private_iv')
    .eq('active', true)
    .order('created_at', { ascending: false });

  // Iterate newest-first and return the first key this environment can actually
  // open. `ENCRYPTION_KEY` differs between dev and prod, so a row sealed by the
  // other environment (e.g. a dev box pointed at prod Supabase) won't decrypt —
  // skip it rather than throw, and fall back to minting a fresh valid key. JWKS
  // serves every public key, so tokens signed with the fresh key still validate.
  for (const row of (data as SigningKeyRow[] | null) ?? []) {
    try {
      const privJwk = JSON.parse(openSecret(row.private_ciphertext, row.private_iv)) as JWK;
      const privateKey = await importJWK(privJwk, row.alg);
      return { kid: row.kid, alg: row.alg, privateKey, publicJwk: row.public_jwk };
    } catch {
      /* sealed by a different ENCRYPTION_KEY — try the next active key */
    }
  }
  return createSigningKey();
}

async function createSigningKey(): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const privateJwk = (await exportJWK(privateKey)) as JWK;
  const kid = crypto.randomUUID().replace(/-/g, '');
  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = 'sig';

  const sealed = sealSecret(JSON.stringify(privateJwk));
  const sb = supabaseAdmin();
  await sb.from('gateway_signing_keys').insert({
    kid,
    alg: ALG,
    public_jwk: publicJwk,
    private_ciphertext: sealed.ciphertext,
    private_iv: sealed.iv,
    active: true,
  });

  const imported = await importJWK(privateJwk, ALG);
  return { kid, alg: ALG, privateKey: imported, publicJwk };
}

/**
 * Public JWKS set for the gateway to validate against. Returns every standalone
 * signing key (newest first). During the Better Auth removal it also includes
 * the legacy Better Auth public keys (best-effort, no decryption needed for
 * public keys) so tokens minted by the old path still validate during the
 * overlap. The legacy inclusion is dropped in S7.
 */
export async function getJwksPublicKeys(): Promise<JWK[]> {
  const keys: JWK[] = [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('gateway_signing_keys')
    .select('public_jwk')
    .order('created_at', { ascending: false });
  for (const r of (data as { public_jwk: JWK }[] | null) ?? []) keys.push(r.public_jwk);

  // Legacy Better Auth public keys — overlap-only, removed in S7.
  if (env.GATEWAY_JWT_INCLUDE_LEGACY_JWKS !== 'false') {
    try {
      const { jwks } = await import('@minion-stack/db/schema');
      const { getDb } = await import('$server/db/client');
      const rows = await getDb().select({ id: jwks.id, publicKey: jwks.publicKey }).from(jwks);
      for (const r of rows) {
        try {
          const jwk = JSON.parse(r.publicKey) as JWK;
          jwk.kid ??= r.id;
          jwk.alg ??= ALG;
          jwk.use ??= 'sig';
          keys.push(jwk);
        } catch {
          /* skip malformed legacy key */
        }
      }
    } catch {
      /* Turso jwks unavailable — fine, standalone keys suffice */
    }
  }
  return keys;
}

/**
 * Issue a gateway JWT with custom claims for the specified user.
 *
 * Signs with a standalone EdDSA keypair (persisted in `gateway_signing_keys`,
 * sealed with `ENCRYPTION_KEY`). Issuer + audience are kept stable so the
 * gateway's `oidcIssuers` keeps validating after Better Auth is removed.
 */
export async function issueGatewayJwt(
  ctx: TenantContext,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  // 1. Role from the Supabase profile (auth system-of-record).
  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) {
    throw new Error(`User not found: ${userId}`);
  }
  const role = ((profile as { role: string | null }).role ?? 'user') as 'admin' | 'user';

  // 2. Agent IDs assigned to this user across the tenant.
  const agentRows = await ctx.db
    .select({ agentId: userAgents.agentId })
    .from(userAgents)
    .where(eq(userAgents.userId, userId));
  const agentIds = [...new Set(agentRows.map((r) => r.agentId))];

  // 3. Sign with the standalone key.
  const { privateKey, kid } = await loadActiveSigningKey();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = (nowSeconds + JWT_EXPIRY_SECONDS) * 1000; // ms for the client

  const claims: GatewayJwtClaims = { userId, role, agentIds, orgId: ctx.tenantId };

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG, kid })
    .setSubject(userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + JWT_EXPIRY_SECONDS)
    .setIssuer(gatewayJwtIssuer())
    .setAudience('openclaw-gateway')
    .sign(privateKey);

  return { token, expiresAt };
}
