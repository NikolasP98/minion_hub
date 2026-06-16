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
import { supabaseAdmin } from '$server/supabase';
import { resolveIdentity } from '$server/auth/resolve-identity';
import { env } from '$env/dynamic/private';
import { startBackupScheduler } from '$server/services/backup-scheduler';
import { mintWorkforceIdentity } from '$lib/server/workforce-identity';
import { getOrgCompanyId } from '$lib/server/workforce-company';
import { initCache } from '$lib/server/cache';
import { getCoreDb } from '$server/db/pg-client';
import { getUserPreferences } from '$server/services/user-preferences.service';

/**
 * Resolve the landing page for a signed-in user hitting "/". Defaults to
 * `/home`; honors the per-user `landingPage` preference (set via right-click →
 * "Set as home page" in the sidebar). Best-effort — any lookup failure falls
 * back to the default so the root redirect never 500s.
 */
async function resolveLandingPage(supabaseId: string | undefined): Promise<string> {
  const DEFAULT = '/home';
  if (!supabaseId) return DEFAULT;
  try {
    const prefs = await getUserPreferences(getCoreDb(), supabaseId);
    const choice = prefs.landingPage;
    // Same-origin guard: must be a root-relative path, NOT a protocol-relative
    // (`//evil.com`) or backslash-tricked (`/\evil.com`) URL that the browser
    // would resolve off-site. Prevents open-redirect via a poisoned preference.
    if (
      typeof choice === 'string' &&
      choice.startsWith('/') &&
      !choice.startsWith('//') &&
      !choice.startsWith('/\\')
    ) {
      return choice;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT;
}

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
      // Tenancy source of truth = Supabase organizations (Turso `organization`
      // was dropped in S7). The Turso db handle stays on the ctx for telemetry/
      // servers reads; tenantId is the canonical Supabase org id.
      const { data: org } = await supabaseAdmin()
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (org) event.locals.tenantCtx = { db: getDb(), tenantId: (org as { id: string }).id };
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

  // Authenticated users landing on "/" go to their chosen home page (default
  // /home). The destination is user-configurable via the sidebar right-click
  // "Set as home page" action (stored in the `landingPage` preference).
  if (event.locals.user && path === '/') {
    const location = await resolveLandingPage(event.locals.user.supabaseId);
    return new Response(null, { status: 307, headers: { location } });
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

const workforceIdentityHandle: Handle = async ({ event, resolve }) => {
  if (event.locals.user) {
    // Company is scoped to the active hub org. Only resolve it for routes that
    // actually consume it (the workforce UI + the workforce backend proxy) so we
    // don't pay a Supabase read on every request. The company cookie is no
    // longer the carrier (org is the source of truth); read it only as a
    // legacy fallback when no org mapping exists.
    const path = event.url.pathname;
    const needsCompany =
      path.startsWith('/workforce') ||
      path.startsWith('/api/workforce') ||
      path.startsWith('/api/pc');
    const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
    let companyId: string | null = null;
    if (needsCompany) {
      companyId =
        (orgId ? await getOrgCompanyId(orgId) : null) ??
        event.cookies.get('workforce_company_id') ??
        event.cookies.get('pc_company_id') ??
        null;
    }

    const boardKey = env.HUB_WORKFORCE_BOARD_KEY ?? env.HUB_PAPERCLIP_BOARD_KEY ?? null;
    if (boardKey) {
      event.locals.workforceIdentity = {
        token: boardKey,
        companyId,
        userId: event.locals.user.id,
      };
    } else {
      try {
        const token = await mintWorkforceIdentity({
          userId: event.locals.user.id,
          email: event.locals.user.email ?? null,
          name: event.locals.user.displayName ?? null,
          companyId,
        });
        event.locals.workforceIdentity = {
          token,
          companyId,
          userId: event.locals.user.id,
        };
      } catch (err) {
        console.warn('[workforceIdentityHandle] no auth configured:', err);
      }
    }
  }
  return resolve(event);
};

export const handle = sequence(i18n.handle(), posthogProxyHandle, wellKnownHandle, appHandle, workforceIdentityHandle);

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
