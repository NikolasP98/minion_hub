// Hoist .env values into process.env at boot — server modules that read raw
// `process.env` (e.g. ssrf-guard for vitest testability) see them in dev mode.
// Must run before any server-only module is loaded; this import is first.
import '$server/env-hoist';

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { i18n } from '$lib/i18n';
import { getPostHogClient } from '$lib/server/posthog';
import { getAuth } from '$lib/auth/auth';
import { building } from '$app/environment';
import { getDb } from '$server/db/client';
import { servers, organization, user as userTable, jwks, member } from '@minion-stack/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '$server/auth/crypto';
import { resolveSupabaseUser } from '$server/auth/supabase-bridge.runtime';
import { env } from '$env/dynamic/private';
import { startBackupScheduler } from '$server/services/backup-scheduler';
import { ensurePersonalAgentOnLogin } from '$server/services/personal-agent.service';
import { mintPaperclipIdentity } from '$lib/server/paperclip-identity';
import { initCache } from '$lib/server/cache';

/**
 * Resolve tenantCtx from a Bearer server token.
 * Used by gateway-to-hub metrics push endpoints.
 *
 * Since tokens are encrypted at rest, we fetch all servers and
 * decrypt-then-compare. Server count per tenant is small (<10).
 */
async function resolveServerTokenAuth(
  authorization: string | null,
): Promise<{ tenantId: string; serverId: string } | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;

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

  return null;
}

/** Paths handled by Better Auth (auth API + OIDC provider endpoints). */
function isBetterAuthPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/') || pathname.startsWith('/api/auth');
}

const authHandle: Handle = async ({ event, resolve }) => {
  // Proxy the standard OIDC discovery endpoint to Better Auth's path
  if (!building && event.url.pathname === '/.well-known/openid-configuration') {
    const internalUrl = new URL('/api/auth/.well-known/openid-configuration', event.url.origin);
    const response = await getAuth().handler(new Request(internalUrl, event.request));
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  if (building || !isBetterAuthPath(event.url.pathname)) {
    return resolve(event);
  }
  try {
    const response = await getAuth().handler(event.request);

    // Re-create the response so Set-Cookie headers are preserved on Vercel.
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    console.error('[authHandle]', event.url.pathname, err);
    return new Response(JSON.stringify({ error: 'Internal auth error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

const UNPROTECTED_PREFIXES = ['/login', '/api/', '/invite/', '/.well-known/', '/auth/'];

const appHandle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // AUTH_DISABLED: skip all auth, resolve first org for API routes to work
  if (env.AUTH_DISABLED === 'true') {
    const db = getDb();
    const rows = await db.select({ id: organization.id }).from(organization).limit(1);
    if (rows.length > 0) event.locals.tenantCtx = { db, tenantId: rows[0].id };
    event.locals.user = {
      id: 'local',
      email: 'local@dev',
      displayName: 'Local Dev',
      role: 'admin',
    };
    return resolve(event);
  }

  // Supabase auth (becomes default). Resolves locals.user via the supabase->legacy
  // bridge so downstream Turso-keyed loads + (app) layout org auto-activation work.
  // Leaves locals.session unset (no Better Auth session row); the (app) layout load
  // resolves org from `member` by user.id and guards the session-table write.
  if (env.AUTH_PROVIDER === 'supabase' && env.AUTH_DISABLED !== 'true' && !path.startsWith('/api/metrics/')) {
    const bridged = await resolveSupabaseUser(event);
    if (bridged) {
      const db = getDb();
      event.locals.user = {
        id: bridged.id,
        email: bridged.email,
        displayName: bridged.displayName,
        role: bridged.role,
        supabaseId: bridged.supabaseId,
      };
      const [m] = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .where(eq(member.userId, bridged.id))
        .limit(1);
      if (m?.orgId) {
        event.locals.orgId = m.orgId;
        event.locals.tenantCtx = { db, tenantId: m.orgId };
      }
    }
    return finishApp({ event, resolve });
  }

  // Bearer token auth for /api/metrics/*
  if (path.startsWith('/api/metrics/')) {
    const authHeader = event.request.headers.get('authorization');
    const serverAuth = await resolveServerTokenAuth(authHeader);
    if (serverAuth) {
      const db = getDb();
      event.locals.tenantCtx = { db, tenantId: serverAuth.tenantId };
      (event.locals as Record<string, unknown>).serverId = serverAuth.serverId;
      return resolve(event);
    }
  }

  // Session auth via Better Auth — Tauri's webview persists cookies natively,
  // so no special desktop handling is needed (verified 2026-05-20).
  let betterAuthSession = null;
  try {
    betterAuthSession = await getAuth().api.getSession({ headers: event.request.headers });
  } catch (err) {
    if (isJwksDecryptError(err) && (await healStaleJwks())) {
      // Self-heal triggered (see healStaleJwks). Retry once with the
      // regenerated keypair. If this also fails, fall through to the
      // unauthenticated path.
      try {
        betterAuthSession = await getAuth().api.getSession({ headers: event.request.headers });
      } catch (retryErr) {
        console.error('[hooks] getSession failed after JWKS heal:', retryErr);
      }
    } else {
      console.error('[hooks] getSession failed, treating as unauthenticated:', err);
    }
  }
  if (betterAuthSession) {
    const db = getDb();
    const [dbUser] = await db
      .select({ role: userTable.role, personalAgentId: userTable.personalAgentId })
      .from(userTable)
      .where(eq(userTable.id, betterAuthSession.user.id))
      .limit(1);
    event.locals.user = {
      id: betterAuthSession.user.id,
      email: betterAuthSession.user.email,
      displayName: betterAuthSession.user.name ?? null,
      role: (dbUser?.role ?? 'user') as 'user' | 'admin',
    };
    event.locals.session = betterAuthSession.session;
    const orgId =
      (betterAuthSession.session as { activeOrganizationId?: string | null })
        .activeOrganizationId ?? undefined;
    event.locals.orgId = orgId;
    if (orgId) {
      const db = getDb();
      event.locals.tenantCtx = { db, tenantId: orgId };
    }

    // Login-time backfill: create personal agent for existing users who don't have one yet.
    // Fire-and-forget: don't block the request. After first successful call,
    // user.personalAgentId is set and this condition won't trigger again.
    if (!dbUser?.personalAgentId) {
      const backfillDb = getDb();
      ensurePersonalAgentOnLogin(
        { db: backfillDb, tenantId: orgId ?? 'default' },
        {
          userId: betterAuthSession.user.id,
          email: betterAuthSession.user.email,
          serverId: '',
        },
      ).catch((err) => console.error('[personal-agent] Login backfill failed:', err));
    }
  }

  return finishApp({ event, resolve });
};

/**
 * Shared tail for appHandle — runs after locals.user/tenantCtx have been set
 * (or left unset) by whichever auth branch handled the request. Both the
 * Better Auth path and the Supabase bridge path route through here so the
 * unauthenticated-API fallback + redirect logic isn't duplicated.
 */
const finishApp: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // For API routes: unauthenticated fallback is restricted to explicitly safe paths only.
  // Sensitive routes (workshop, flows, personal-agent, users) require explicit auth and
  // must NOT fall through to the tenant fallback — individual route handlers call requireAuth().
  // Each entry is matched both as an exact path and as a prefix (with the
  // trailing slash appended) so e.g. `/api/servers` AND `/api/servers/123`
  // both fall through. Previously only the trailing-slash form was matched
  // which let the LIST endpoint (no slash) silently 401, freezing the
  // client-side hosts cache in a stale state.
  const API_UNAUTH_FALLBACK_PATHS = [
    '/api/marketplace',
    '/api/registry',
    '/api/servers',
    '/api/metrics',
    '/api/gateway',
    '/api/device-identity',
    '/api/studio',
    '/api/admin',
    '/api/invitations',
    // Self-serve join: a no-org (no tenantCtx) but authenticated user must be
    // able to POST a join request. Handlers enforce their own auth (requireAuth
    // / requireAdmin), so falling through here is safe — mirrors /api/invitations.
    '/api/join-requests',
    '/api/gateways',
    '/api/auth',
  ];
  if (!event.locals.tenantCtx && path.startsWith('/api/')) {
    const allowFallback = API_UNAUTH_FALLBACK_PATHS.some(
      (p) => path === p || path.startsWith(`${p}/`),
    );
    if (allowFallback) {
      const db = getDb();
      const rows = await db.select({ id: organization.id }).from(organization).limit(1);
      if (rows.length > 0) event.locals.tenantCtx = { db, tenantId: rows[0].id };
      return resolve(event);
    }
    // All other unauthenticated API requests get an explicit 401
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Redirect unauthenticated browser requests to /login
  const isUnprotected = UNPROTECTED_PREFIXES.some((p) => path.startsWith(p));
  if (!event.locals.user && !isUnprotected) {
    const redirectTo = path !== '/' ? `?redirectTo=${encodeURIComponent(path)}` : '';
    return new Response(null, {
      status: 302,
      headers: { location: `/login${redirectTo}` },
    });
  }

  // Redirect authenticated users away from /login
  if (event.locals.user && path === '/login') {
    return new Response(null, { status: 302, headers: { location: '/' } });
  }

  // All authenticated users land on /my-agent by default. The legacy admin
  // landing (agents list) now lives at /agents. Per-user override picker
  // ships in Phase 1.5 (DB-backed users.home_page_choice).
  if (event.locals.user && path === '/') {
    return new Response(null, { status: 307, headers: { location: '/my-agent' } });
  }

  return resolve(event);
};

const posthogProxyHandle: Handle = async ({ event, resolve }) => {
  // D-09: skip PostHog proxy in desktop mode
  if (env.DESKTOP === '1') return resolve(event);

  const { pathname } = event.url;
  if (pathname.startsWith('/ingest')) {
    const hostname = pathname.startsWith('/ingest/static/')
      ? 'us-assets.i.posthog.com'
      : 'us.i.posthog.com';
    const url = new URL(event.request.url);
    url.protocol = 'https:';
    url.hostname = hostname;
    url.port = '443';
    url.pathname = pathname.replace(/^\/ingest/, '');
    const headers = new Headers(event.request.headers);
    headers.set('host', hostname);
    headers.set('accept-encoding', '');
    const clientIp = event.request.headers.get('x-forwarded-for') || event.getClientAddress();
    if (clientIp) headers.set('x-forwarded-for', clientIp);
    return fetch(url.toString(), {
      method: event.request.method,
      headers,
      body: event.request.body,
      // @ts-expect-error - duplex is required for streaming request bodies
      duplex: 'half',
    });
  }
  return resolve(event);
};

const paperclipIdentityHandle: Handle = async ({ event, resolve }) => {
  if (event.locals.user) {
    const companyId = event.cookies.get('pc_company_id') ?? null;
    // Bearer board-key auth mode (Phase 2). Per-user identity is not preserved —
    // paperclip sees all requests as the same board principal. Trade-off accepted
    // to avoid deploying the hub-identity middleware on the Netcup instance.
    // Restore mintPaperclipIdentity() when HUB_PAPERCLIP_SHARED_SECRET is set
    // on both sides.
    const boardKey = env.HUB_PAPERCLIP_BOARD_KEY ?? null;
    if (boardKey) {
      event.locals.paperclipIdentity = {
        token: boardKey,
        companyId,
        userId: event.locals.user.id,
      };
    } else {
      // Try JWT mint as the legacy/dev fallback when board key isn't configured.
      try {
        const token = await mintPaperclipIdentity({
          userId: event.locals.user.id,
          email: event.locals.user.email ?? null,
          name: event.locals.user.displayName ?? null,
          companyId,
        });
        event.locals.paperclipIdentity = {
          token,
          companyId,
          userId: event.locals.user.id,
        };
      } catch (err) {
        // Don't block the request if neither auth mode is configured.
        console.warn('[paperclipIdentityHandle] no auth configured:', err);
      }
    }
  }
  return resolve(event);
};

export const handle = sequence(i18n.handle(), posthogProxyHandle, authHandle, appHandle, paperclipIdentityHandle);

import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  const posthog = await getPostHogClient();
  posthog?.capture({
    distinctId: 'server',
    event: 'server_error',
    properties: {
      error: error instanceof Error ? error.message : String(error),
      status,
      message,
      path: event.url.pathname,
    },
  });
  return { message: 'Internal Error' };
};

startBackupScheduler();

// One-time cache initialization.
void initCache().catch((err) => console.error('[cache] init failed', err));

/**
 * JWKS auto-heal: at-most-once-per-process recovery from stale-secret state.
 *
 * Better Auth's oidcProvider encrypts the JWKS private key with BETTER_AUTH_SECRET.
 * If the secret changes between server boots (Infisical rotation, switching .env vs
 * .env.local, switching dev vs desktop contexts, restoring from backup, etc.) the
 * row in the `jwks` table can no longer be decrypted and every authenticated
 * request fails silently — login form just resets, no surface error.
 *
 * Reactive heal: the catch block in authHandle detects any JWT-signing-path
 * error that indicates an unreadable JWKS row (`Failed to decrypt private key`
 * with the right secret, or `... is not valid JSON` from a malformed row),
 * deletes the stale row, and retries once. Better Auth lazily regenerates the
 * keypair on the next JWKS access using the current secret.
 *
 * Idempotency: jwksHealAttempted flips to `true` after the first heal so we
 * don't loop on a real (non-decrypt) auth error. The flag survives the process
 * lifetime — if the secret is rotated AGAIN mid-run we'd need a restart, but
 * that's vanishingly rare and a restart is cheap.
 */
let jwksHealAttempted = false;
function isJwksDecryptError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  const stack = err.stack ?? '';
  // Better Auth's wrapper error when a valid encrypted JSON private key
  // can't be decrypted with the current BETTER_AUTH_SECRET.
  if (msg.includes('Failed to decrypt private key')) return true;
  // Underlying JSON.parse failure on the stored private_key field — fires
  // when the row is malformed (partial write, corrupted backup, test shim).
  // Both originate from the JWT-signing path in the jwt/oidc plugin.
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
