// Identity resolution for the request pipeline (R2 of the auth-simplification plan,
// specs/2026-05-26-auth-token-simplification.md).
//
// Pulls the four auth branches that used to live inline in hooks.server.ts'
// `appHandle` into one place behind a single entry point, `resolveIdentity()`.
// Each branch is a named provider function so the permanent dual-mode IdP switch
// (`AUTH_PROVIDER`: supabase=cloud default, better-auth=self-host) reads as a
// provider selection, not a tangle of conditionals in the hot path.
//
// This module is a behavior-preserving extraction: the control flow (which
// branches short-circuit past the redirect/401 gate, which fall through) and
// the per-branch tenant-resolution rules are identical to the previous inline
// version. See `bypassGate` and `fallbackToMembership` below.

import type { RequestEvent } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { servers, user as userTable, jwks } from '@minion-stack/db/schema';
import { gateway } from '@minion-stack/db/pg';
import { getDb } from '$server/db/client';
import { getCoreDb } from '$server/db/pg-client';
import { getAuth } from '$lib/auth/auth';
import { supabaseAdmin } from '$server/supabase';
import { decryptToken } from '$server/auth/crypto';
import { resolveSupabaseUser, resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';
import { resolveUserTenant } from '$server/auth/tenant';
import { ensurePersonalAgentOnLogin } from '$server/services/personal-agent.service';
import { env } from '$env/dynamic/private';

export { resolveUserTenant } from '$server/auth/tenant';

/** The subset of `App.Locals` that an identity provider populates. */
type LocalsPatch = Pick<App.Locals, 'user' | 'session' | 'orgId' | 'tenantCtx' | 'serverId'>;

export interface IdentityResolution {
  /** Fields to assign onto `event.locals`. */
  locals: LocalsPatch;
  /**
   * When true, skip the shared app gate (redirect/401 logic in `finishApp`)
   * and resolve the request directly. Matches the original behavior where the
   * AUTH_DISABLED and successful /api/metrics bearer branches returned
   * `resolve(event)` rather than routing through the shared tail.
   */
  bypassGate: boolean;
}

const ANON: IdentityResolution = { locals: {}, bypassGate: false };

/**
 * Resolve tenantCtx from a Bearer server token (gateway→hub metrics push).
 * Tokens are encrypted at rest, so we decrypt-then-compare. Server count per
 * tenant is small (<10). (Indexing this is R6 in the simplification plan.)
 */
export async function resolveServerTokenAuth(
  authorization: string | null,
): Promise<{ tenantId: string; serverId: string } | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;

  // Primary: Supabase `gateway` (system-of-record). org_id supplies the tenant
  // (the Turso `servers.tenant_id` equivalent). getCoreDb runs as the bypass role
  // — correct here: this is a system auth path with no user context, resolving
  // WHICH org a gateway token belongs to. A Supabase miss (or any error) falls
  // through to the Turso `servers` path below (dual-read bake; reversible).
  try {
    const gwRows = await getCoreDb()
      .select({
        id: gateway.id,
        legacyServerId: gateway.legacyServerId,
        // org_id is newer than the vendored @minion-stack/db tarball's gateway
        // type, so select it via a raw column expression (see 20260606230000).
        orgId: sql<string | null>`org_id`,
        token: gateway.tokenCiphertext,
        tokenIv: gateway.tokenIv,
      })
      .from(gateway);
    for (const row of gwRows) {
      if (!row.token || !row.orgId) continue;
      const stored = row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token;
      if (stored === token) {
        return { tenantId: row.orgId, serverId: row.legacyServerId ?? row.id };
      }
    }
  } catch (err) {
    console.error(
      '[resolve-identity] Supabase gateway token lookup failed; falling back to Turso servers:',
      err,
    );
  }

  // Fallback: legacy Turso `servers` (telemetry-adjacent) during the gateway-token
  // cutover bake. Track A2 kill-switch: set GATEWAY_TURSO_FALLBACK=false to go
  // Supabase-only once proven; the branch is removed entirely in Track C.
  if (env.GATEWAY_TURSO_FALLBACK !== 'false') {
    const db = getDb();
    const rows = await db
      .select({
        id: servers.id,
        tenantId: servers.tenantId,
        token: servers.token,
        tokenIv: servers.tokenIv,
      })
      .from(servers);

    for (const row of rows) {
      const stored = row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token;
      if (stored === token) {
        return { tenantId: row.tenantId, serverId: row.id };
      }
    }
  }
  return null;
}

// --- Providers ----------------------------------------------------------------

/** AUTH_DISABLED dev mode: fabricate a local admin and grab the first org. */
async function resolveAuthDisabled(): Promise<IdentityResolution> {
  const { data } = await supabaseAdmin().from('organizations').select('id').limit(1).maybeSingle();
  const tenantCtx = data ? { db: getDb(), tenantId: (data as { id: string }).id } : undefined;
  return {
    locals: {
      tenantCtx,
      user: { id: 'local', email: 'local@dev', displayName: 'Local Dev', role: 'admin' },
    },
    bypassGate: true,
  };
}

/**
 * Supabase (cloud, default) provider. Resolves locals.user via the
 * supabase→legacy bridge so downstream Turso-keyed loads + (app) layout org
 * auto-activation work. Leaves locals.session unset (no Better Auth session row).
 */
async function resolveViaSupabase(event: RequestEvent): Promise<IdentityResolution> {
  const bridged = await resolveSupabaseUser(event);
  if (!bridged) return ANON;
  const db = getDb();

  // Tenancy source of truth = Supabase organization_members (keyed by profile
  // uuid). Falls back to the legacy Turso `member` lookup during bake-in so a
  // user with no Supabase membership row still resolves exactly as before.
  // (On prod both stores agree on the same org id, so this is behavior-
  // preserving; the Supabase read is what lets Turso be dropped from tenancy.)
  // Honor the org switcher: the active_org cookie (set by /api/active-org) is the
  // preferred org. resolveSupabaseTenant only returns it if the user is actually a
  // member, else it falls back to the alphabetical-first org (its default).
  const preferredOrgId = event.cookies.get('active_org') ?? null;
  const supaOrgId = bridged.supabaseId
    ? (await resolveSupabaseTenant(bridged.supabaseId, preferredOrgId))?.orgId
    : undefined;
  const orgId =
    supaOrgId ??
    (await resolveUserTenant(db, { userId: bridged.id, fallbackToMembership: true }))?.orgId;
  const tenantCtx = orgId ? { db, tenantId: orgId } : undefined;

  return {
    locals: {
      user: {
        id: bridged.id,
        email: bridged.email,
        displayName: bridged.displayName,
        avatarUrl: bridged.avatarUrl,
        role: bridged.role,
        supabaseId: bridged.supabaseId,
        createdAt: bridged.createdAt,
      },
      orgId,
      tenantCtx,
    },
    bypassGate: false,
  };
}

/** Bearer-token provider for /api/metrics/* (gateway metrics push). */
async function resolveViaMetricsBearer(event: RequestEvent): Promise<IdentityResolution | null> {
  const authHeader = event.request.headers.get('authorization');
  const serverAuth = await resolveServerTokenAuth(authHeader);
  if (!serverAuth) return null; // fall through to session auth
  const db = getDb();
  return {
    locals: { tenantCtx: { db, tenantId: serverAuth.tenantId }, serverId: serverAuth.serverId },
    bypassGate: true,
  };
}

/** Better Auth (self-host) session provider. */
async function resolveViaBetterAuth(event: RequestEvent): Promise<IdentityResolution> {
  // Tauri's webview persists cookies natively, so no special desktop handling.
  let session = null;
  try {
    session = await getAuth().api.getSession({ headers: event.request.headers });
  } catch (err) {
    if (isJwksDecryptError(err) && (await healStaleJwks())) {
      // Self-heal triggered (see healStaleJwks). Retry once with the
      // regenerated keypair. If this also fails, treat as unauthenticated.
      try {
        session = await getAuth().api.getSession({ headers: event.request.headers });
      } catch (retryErr) {
        console.error('[resolve-identity] getSession failed after JWKS heal:', retryErr);
      }
    } else {
      console.error('[resolve-identity] getSession failed, treating as unauthenticated:', err);
    }
  }
  if (!session) return ANON;

  const db = getDb();
  const [dbUser] = await db
    .select({ role: userTable.role, personalAgentId: userTable.personalAgentId })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
    .limit(1);

  const activeOrganizationId = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  const tenant = await resolveUserTenant(db, {
    userId: session.user.id,
    activeOrganizationId,
    fallbackToMembership: false,
  });

  // Login-time backfill: create personal agent for existing users without one.
  // Fire-and-forget + idempotent (ensurePersonalAgentOnLogin checks existence
  // first). personal_agents lives on Supabase (pg) now; the Turso
  // `user.personalAgentId` gate is best-effort (may re-attempt harmlessly for
  // pg-provisioned self-host users). This is the Better-Auth branch only —
  // the cloud-default Supabase branch does not run login backfill.
  if (!dbUser?.personalAgentId) {
    ensurePersonalAgentOnLogin(
      { db: getCoreDb(), tenantId: tenant?.orgId ?? 'default' },
      { userId: session.user.id, email: session.user.email, serverId: '' },
    ).catch((err) => console.error('[personal-agent] Login backfill failed:', err));
  }

  return {
    locals: {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.name ?? null,
        role: (dbUser?.role ?? 'user') as 'user' | 'admin',
      },
      session: session.session,
      orgId: tenant?.orgId,
      tenantCtx: tenant?.ctx,
    },
    bypassGate: false,
  };
}

/**
 * Resolve the request's identity through the active provider. Order matches the
 * previous inline `appHandle`: AUTH_DISABLED → Supabase (non-metrics) →
 * /api/metrics bearer → Better Auth session.
 */
export async function resolveIdentity(event: RequestEvent): Promise<IdentityResolution> {
  const path = event.url.pathname;

  if (env.AUTH_DISABLED === 'true') {
    return resolveAuthDisabled();
  }

  // Paths where a gateway server-token Bearer should be honored instead of the
  // browser-session Supabase provider (gateway→hub push: metrics, message
  // ledger, agent-memory corpus ingest).
  const isServerTokenPath =
    path.startsWith('/api/metrics/') ||
    path === '/api/messages/ingest' ||
    path === '/api/agent-memories/ingest' ||
    path === '/api/agent-memories/recall' ||
    path === '/api/agent-memories/delete';

  if (env.AUTH_PROVIDER === 'supabase' && !isServerTokenPath) {
    return resolveViaSupabase(event);
  }

  if (isServerTokenPath) {
    const bearer = await resolveViaMetricsBearer(event);
    if (bearer) return bearer;
  }

  return resolveViaBetterAuth(event);
}

// --- JWKS auto-heal ------------------------------------------------------------
//
// Better Auth's oidcProvider encrypts the JWKS private key with BETTER_AUTH_SECRET.
// If the secret changes between boots (Infisical rotation, .env vs .env.local,
// dev vs desktop, restoring from backup) the `jwks` row can no longer be
// decrypted and every authenticated request fails silently. The reactive heal
// below clears the stale row so Better Auth regenerates the keypair on next
// access. At-most-once per process (jwksHealAttempted) so a real auth error
// doesn't loop; a second mid-run rotation would need a restart (vanishingly rare).
// (R9 in the simplification plan replaces this with modeled rotation.)

let jwksHealAttempted = false;

export function isJwksDecryptError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  const stack = err.stack ?? '';
  if (msg.includes('Failed to decrypt private key')) return true;
  if (stack.includes('/plugins/jwt/sign') || stack.includes('/plugins/jwt/index')) {
    if (msg.includes('is not valid JSON') || msg.includes('decrypt') || msg.includes('JWK')) {
      return true;
    }
  }
  return false;
}

async function healStaleJwks(): Promise<boolean> {
  if (jwksHealAttempted) return false;
  jwksHealAttempted = true;
  console.warn(
    '[jwks-heal] decrypt failed with current BETTER_AUTH_SECRET — clearing stale row so Better Auth can regenerate. ' +
      'Expected after secret rotation, switching .env contexts, or restoring from backup.',
  );
  try {
    const db = getDb();
    const result = await db.delete(jwks);
    console.warn(
      `[jwks-heal] stale row cleared (${result.rowsAffected ?? '?'} row); ` +
        'next request will regenerate the keypair.',
    );
    return true;
  } catch (delErr) {
    console.error('[jwks-heal] failed to clear stale row:', delErr);
    return false;
  }
}
