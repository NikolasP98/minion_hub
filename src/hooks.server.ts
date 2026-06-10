// Hoist .env values into process.env at boot — server modules that read raw
// `process.env` (e.g. ssrf-guard for vitest testability) see them in dev mode.
// Must run before any server-only module is loaded; this import is first.
import '$server/env-hoist';

import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { i18n } from '$lib/i18n';
import { getPostHogClient } from '$lib/server/posthog';
import { building } from '$app/environment';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';
import { resolveIdentity } from '$server/auth/resolve-identity';
import { env } from '$env/dynamic/private';
import { startBackupScheduler } from '$server/services/backup-scheduler';
import { mintPaperclipIdentity } from '$lib/server/paperclip-identity';
import { initCache } from '$lib/server/cache';

/**
 * Hand-serve OIDC discovery + JWKS for the gateway JWT (S5: standalone jose
 * keypair, decoupled from Better Auth). The issuer is unchanged so the gateway's
 * `oidcIssuers` keeps validating; `jwks_uri` now points at our own endpoint
 * which serves the standalone public key(s). Reachable unauthenticated (the
 * `/.well-known/` prefix is in UNPROTECTED_PREFIXES).
 */
const wellKnownHandle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  const path = event.url.pathname;

  if (path === '/.well-known/jwks.json') {
    const { getJwksPublicKeys } = await import('$server/services/gateway-jwt.service');
    const keys = await getJwksPublicKeys();
    return new Response(JSON.stringify({ keys }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
    });
  }

  if (path === '/.well-known/openid-configuration') {
    const { gatewayJwtIssuer } = await import('$server/services/gateway-jwt.service');
    const issuer = gatewayJwtIssuer();
    const config = {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'nbf', 'iat', 'jti', 'role', 'agentIds', 'orgId'],
    };
    return new Response(JSON.stringify(config), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
    });
  }

  return resolve(event);
};

const UNPROTECTED_PREFIXES = ['/login', '/api/', '/invite/', '/.well-known/', '/auth/'];

const appHandle: Handle = async ({ event, resolve }) => {
  // Identity resolution (provider selection + tenant context) lives in
  // $server/auth/resolve-identity. appHandle just applies the result and runs
  // the shared app gate — unless the provider opted out (AUTH_DISABLED and the
  // /api/metrics bearer path resolve directly, as before).
  const { locals, bypassGate } = await resolveIdentity(event);
  Object.assign(event.locals, locals);
  return bypassGate ? resolve(event) : finishApp({ event, resolve });
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
    '/api/admin',
    // Self-serve join: a no-org (no tenantCtx) but authenticated user must be
    // able to POST a join request. Handlers enforce their own auth (requireAuth
    // / requireAdmin), so falling through here is safe — mirrors /api/invitations.
    '/api/join-requests',
    '/api/gateways',
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
    // Internal server-to-server routes (e.g. /api/internal/*) do their own
    // Bearer-token check — bypass the user-auth gate and let the handler run.
    if (path.startsWith('/api/internal/')) {
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
    // Preserve the full path + query so e.g. a `/join?token=…` invite link
    // survives the round-trip through sign-in.
    const target = path + event.url.search;
    const redirectTo = path !== '/' ? `?redirectTo=${encodeURIComponent(target)}` : '';
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

export const handle = sequence(i18n.handle(), posthogProxyHandle, wellKnownHandle, appHandle, paperclipIdentityHandle);

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
