// Identity resolution for the request pipeline (R2 of the auth-simplification plan,
// specs/2026-05-26-auth-token-simplification.md).
//
// Supabase Auth (GoTrue) is the sole identity provider. This module pulls the
// remaining auth branches that used to live inline in hooks.server.ts' `appHandle`
// into one place behind a single entry point, `resolveIdentity()`:
//   AUTH_DISABLED dev bypass → /api/{metrics,messages,agent-memories} server-token
//   Bearer (gateway→hub push) → Supabase browser session.
//
// Better Auth (self-host session provider + JWKS auto-heal) was removed in the
// GoTrue migration — see docs/2026-06-10-betterauth-to-supabase-migration.md.

import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { servers } from '@minion-stack/db/schema';
import { gateway } from '@minion-stack/db/pg';
import { getDb } from '$server/db/client';
import { getCoreDb } from '$server/db/pg-client';
import { supabaseAdmin } from '$server/supabase';
import { decryptToken } from '$server/auth/crypto';
import { resolveSupabaseUser, resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';
import { resolveUserTenant } from '$server/auth/tenant';
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
 * Supabase (GoTrue) session provider. Resolves locals.user via the
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

/** Bearer-token provider for gateway→hub push (/api/metrics/*, ledger, memory). */
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

/**
 * Resolve the request's identity. Order: AUTH_DISABLED → server-token Bearer
 * (gateway push paths) → Supabase browser session.
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
    path === '/api/agent-memories/delete' ||
    // gateway credential-resolve endpoints (return decrypted ADC; each handler
    // additionally requires locals.serverId / admin / self — see the routes).
    path === '/api/gateway/google-identities' ||
    path === '/api/gateway/google-adc';

  if (isServerTokenPath) {
    const bearer = await resolveViaMetricsBearer(event);
    if (bearer) return bearer;
    // No valid server token on a push path → fall through to session auth
    // (e.g. a browser hitting the same endpoint with a Supabase cookie).
  }

  return resolveViaSupabase(event);
}
