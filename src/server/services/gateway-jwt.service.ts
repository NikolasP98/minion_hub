import { eq } from 'drizzle-orm';
import { SignJWT, importJWK, exportJWK, generateKeyPair, type JWK } from 'jose';
import { userAgents } from '@minion-stack/db/schema';
import { sealSecret, openSecret } from '@minion-stack/db/pg';
import { env } from '$env/dynamic/private';
import type { TenantContext } from './base';
import { loadCanonicalProfile } from './canonical-directory.service';
import {
  insertGatewaySigningKey,
  listActiveGatewaySigningKeys,
  listGatewayPublicJwks,
} from './gateway-signing-key.repository';

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
  const rows = await listActiveGatewaySigningKeys();

  // Iterate newest-first and return the first key this environment can actually
  // open. `ENCRYPTION_KEY` differs between dev and prod, so a row sealed by the
  // other environment (e.g. a dev box pointed at prod Supabase) won't decrypt —
  // skip it rather than throw, and fall back to minting a fresh valid key. JWKS
  // serves every public key, so tokens signed with the fresh key still validate.
  for (const row of rows) {
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
  await insertGatewaySigningKey({
    kid,
    alg: ALG,
    public_jwk: publicJwk,
    private_ciphertext: sealed.ciphertext,
    private_iv: sealed.iv,
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
  for (const row of await listGatewayPublicJwks()) keys.push(row.public_jwk);

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
  // 1. Role from canonical Postgres. Do not route authentication through
  // PostgREST: a REST-gateway restart previously turned this valid profile
  // into a misleading "User not found" 500 while direct Postgres was healthy.
  const profile = await loadCanonicalProfile(userId);
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
