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
import { trustedWorkforceViewerRoleKeys } from '$lib/server/workforce-viewer';
import { canonicalizeWorkforceRoleKeys } from '$lib/server/workforce-role-keys';
import { needsWorkforceIdentity } from '$lib/server/workforce-route';
import { initCache } from '$lib/server/cache';
import { getCoreDb } from '$server/db/pg-client';
import { getUserPreferences } from '$server/services/user-preferences.service';
import { getCachedLanding, setCachedLanding } from '$server/landing-cache';
import { apiWriteCapability, hasOrgCapability } from '$server/services/rbac.service';
import {
  proxyRequestHeaders,
  proxyResponseHeaders,
  safeClientAddress,
} from '$server/http/proxy-headers';

/**
 * Resolve the landing page for a signed-in user hitting "/". Defaults to
 * `/home`; honors the per-user `landingPage` preference (set via right-click →
 * "Set as home page" in the sidebar). Best-effort — any lookup failure falls
 * back to the default so the root redirect never 500s.
 */
async function resolveLandingPage(supabaseId: string | undefined): Promise<string> {
  const DEFAULT = '/home';
  if (!supabaseId) return DEFAULT;
  const cached = getCachedLanding(supabaseId);
  if (cached) return cached;
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
      setCachedLanding(supabaseId, choice);
      return choice;
    }
  } catch {
    /* fall through to default — and don't cache, so a transient PG error
       doesn't pin the default for the whole TTL */
    return DEFAULT;
  }
  // Valid lookup with no (or an unsafe) preference: cache the default so the
  // common "no custom home page" case stops re-querying PG every `/` hit.
  setCachedLanding(supabaseId, DEFAULT);
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
      claims_supported: [
        'sub',
        'iss',
        'aud',
        'exp',
        'nbf',
        'iat',
        'jti',
        'role',
        'agentIds',
        'orgId',
      ],
    };
    return new Response(JSON.stringify(config), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
    });
  }

  return resolve(event);
};

/**
 * exe.dev protects private workstation proxies with WebAuthn. Delegate only
 * passkey assertion (not passkey creation) to exe.dev frames on Cloud pages so
 * browser password managers such as 1Password can complete the ceremony in the
 * embedded desktop instead of requiring a separate top-level login tab.
 */
const cloudPasskeyHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname === '/cloud' || event.url.pathname.startsWith('/cloud/')) {
    response.headers.set(
      'Permissions-Policy',
      'publickey-credentials-get=(self "https://exe.dev" "https://*.exe.xyz")',
    );
  }
  return response;
};

const UNPROTECTED_PREFIXES = ['/login', '/api/', '/invite/', '/.well-known/', '/auth/', '/book'];

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
    // Cron tick endpoints (driven by Vercel cron or an external scheduler)
    // authenticate via CRON_SECRET Bearer in the handler, not a user session —
    // let them through so the handler can enforce its own auth.
    if (
      path === '/api/scheduling/reminders/tick' ||
      path === '/api/finances/sync/tick' ||
      path === '/api/notifications/tick' ||
      path === '/api/memberships/tick' ||
      path === '/api/org-config/tick' ||
      path === '/api/jobs/tick' ||
      path === '/api/meta/sync/tick' ||
      path === '/api/email-ledger/tick'
    ) {
      return resolve(event);
    }
    // Pre-login auth endpoints: by definition the caller has no session yet.
    // Each handler enforces its own rate limiting and never leaks whether an
    // identifier exists (specs/2026-07-11-hub-password-username-auth.md).
    if (
      path === '/api/auth/password-login' ||
      path === '/api/auth/forgot-password' ||
      path === '/api/auth/reset-password'
    ) {
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

  // Central RBAC write guard: business-data + org-config mutating API calls
  // (/api/crm|finances|sales|scheduling|support|memberships|projects|work|
  // workforce|modules|plugins) require the matching capability. Reads aren't
  // gated here (pages gate their own view); only POST/PUT/PATCH/DELETE. The
  // gateway server-token + cron-tick traffic targets other prefixes, and the
  // anonymous /api/scheduling/public/* booking path is excluded — so only
  // user-driven writes reach this. 403 (JSON) when the role lacks the cap.
  if (event.locals.user) {
    const need = apiWriteCapability(path, event.request.method);
    if (need && !(await hasOrgCapability(event.locals, need.module, need.action))) {
      return new Response(
        JSON.stringify({ error: 'You do not have permission to perform this action.' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
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
    // Browser requests can arrive with transfer framing headers. Forwarding
    // those through Fetch makes Undici reject the request before it reaches
    // PostHog. Hub credentials also have no business crossing this boundary.
    const headers = proxyRequestHeaders(event.request.headers, ['authorization', 'cookie']);
    // Keep the upstream body uncompressed. Fetch also decompresses responses
    // transparently, and forwarding the original encoding header would make
    // Chromium attempt a second decode (ERR_CONTENT_DECODING_FAILED).
    headers.set('accept-encoding', 'identity');
    const clientIp = safeClientAddress(
      event.request.headers.get('x-forwarded-for'),
      event.getClientAddress,
    );
    if (clientIp) headers.set('x-forwarded-for', clientIp);
    const upstream = await fetch(url.toString(), {
      method: event.request.method,
      headers,
      body: event.request.body,
      signal: AbortSignal.timeout(10_000),
      // @ts-expect-error - duplex is required for streaming request bodies
      duplex: 'half',
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: proxyResponseHeaders(upstream.headers),
    });
  }
  return resolve(event);
};

const workforceIdentityHandle: Handle = async ({ event, resolve }) => {
  if (event.locals.user) {
    // The Workforce company id IS the active hub org id (native single-id
    // model). Only attach it for routes that consume it (the workforce UI + the
    // backend proxy) so non-workforce requests skip the work entirely.
    const path = event.url.pathname;
    const needsCompany = needsWorkforceIdentity(path);
    if (!needsCompany) return resolve(event);
    const orgId = event.locals.orgId ?? event.locals.tenantCtx?.tenantId ?? null;
    // Native single-id model: the Workforce company id IS the active org id
    // (company.id === organizations.id). No mapping lookup, no cookie carrier.
    const companyId: string | null = orgId;

    const boardKey = env.HUB_WORKFORCE_BOARD_KEY ?? env.HUB_PAPERCLIP_BOARD_KEY ?? null;
    const hasSharedSecret = Boolean(
      env.HUB_WORKFORCE_SHARED_SECRET ?? env.HUB_PAPERCLIP_SHARED_SECRET,
    );
    // User-facing requests prefer the short-lived signed identity. A pcli board
    // key is service authority and cannot carry the acting member or role set.
    if (boardKey && !hasSharedSecret) {
      event.locals.workforceIdentity = {
        token: boardKey,
        companyId,
        userId: event.locals.user.id,
        roleKeys: [],
        roleAuthority: 'board',
      };
    } else {
      try {
        const roleKeys = canonicalizeWorkforceRoleKeys(
          await trustedWorkforceViewerRoleKeys(event.locals),
        );
        const token = await mintWorkforceIdentity({
          userId: event.locals.user.id,
          email: event.locals.user.email ?? null,
          name: event.locals.user.displayName ?? null,
          companyId,
          roleKeys,
        });
        event.locals.workforceIdentity = {
          token,
          companyId,
          userId: event.locals.user.id,
          roleKeys,
          roleAuthority: 'signed',
        };
      } catch (err) {
        console.warn('[workforceIdentityHandle] no auth configured:', err);
      }
    }
  }
  return resolve(event);
};

export const handle = sequence(
  i18n.handle(),
  cloudPasskeyHandle,
  posthogProxyHandle,
  wellKnownHandle,
  appHandle,
  workforceIdentityHandle,
);

import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  // M8: fire-and-forget. Never await the capture (or the client's dynamic
  // import) on the error path — an error storm must not fan out into synchronous
  // HTTP round-trips that block each failing request's response. The capture
  // enqueues into the batched client (flushAt/flushInterval); a `flush()` nudges
  // it out without blocking. Errors here are swallowed so telemetry can't mask
  // the original error.
  void getPostHogClient()
    .then((posthog) => {
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
      void posthog?.flush?.();
    })
    .catch(() => {});
  return { message: 'Internal Error' };
};

startBackupScheduler();

// One-time cache initialization.
void initCache().catch((err) => console.error('[cache] init failed', err));
