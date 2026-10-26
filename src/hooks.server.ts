// Hoist .env values into process.env at boot — server modules that read raw
// `process.env` (e.g. ssrf-guard for vitest testability) see them in dev mode.
// Must run before any server-only module is loaded; this import is first.
import '$server/env-hoist';

import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { redactGatewayCredential } from '$server/observability/redact-gateway-credential';
import { error, type Handle } from '@sveltejs/kit';
import { planOperationCacheHandle } from '$server/http/plan-operation-cache';
import { i18n } from '$lib/i18n';
import { canonicalPath } from '$lib/canonical-path';
import { captureServerEvent } from '$lib/server/posthog';
import {
  UNKNOWN,
  distinctIdFor,
  releaseContext,
  requestIdentity,
  sanitizeErrorProperties,
} from '$lib/server/observability-context';
import { createServerTimingHandle } from '$lib/server/server-timing';
import { building } from '$app/environment';
import { resolveIdentity } from '$server/auth/resolve-identity';
import { isDevBackend } from '$server/dev-backend';
import { env } from '$env/dynamic/private';
import { mintWorkforceIdentity } from '$lib/server/workforce-identity';
import { trustedWorkforceViewerRoleKeys } from '$lib/server/workforce-viewer';
import { canonicalizeWorkforceRoleKeys } from '$lib/server/workforce-role-keys';
import { needsWorkforceIdentity } from '$lib/server/workforce-route';
import { initCache, initCacheDataPlane } from '$lib/server/cache';
import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import { applyOrgTxScope } from '$server/db/with-org-core';
import { createAmbientOrgTx } from '$server/db/ambient-org-tx';
import { runWithAiUsageScope } from '$server/ai-usage';
import { getUserPreferences } from '$server/services/user-preferences.service';
import { getCachedLanding, setCachedLanding } from '$server/landing-cache';
import { availableLanguageTags } from '$lib/paraglide/runtime';
import {
  apiWriteCapability,
  hasOrgCapability,
  type Module,
  type PermAction,
} from '$server/services/rbac.service';
import { loadPermissionsForUser } from '$server/services/permissions.service';
import { decideRouteAccess } from '$lib/routes/route-access-policies';
import { listModuleStates } from '$server/services/modules.service';
import { isAppRouteBlocked, shouldApplyOrganizationRouteGuards } from '$lib/modules/route-guard';
import {
  proxyRequestHeaders,
  proxyResponseHeaders,
  safeClientAddress,
} from '$server/http/proxy-headers';
import { BUILD_CHANNEL_COOKIE, runWithBuildChannel } from '$server/gateway-channel';
import { isGatewayChannel } from '$server/services/gateway.pg.service';
import { waitUntil } from '@vercel/functions';
import { storePerformanceSample } from '$server/services/performance-monitor.service';
import { isCronAuthPath } from '$lib/server/cron-auth-path';
import { installWorkerLifecycle, trackWorkerRequest } from '$server/worker-lifecycle';
import { bootstrapNotificationWorker } from '$server/services/notifications/worker-bootstrap';
import { runWithSqlTrace } from '$server/db/sql-trace';
import { shouldActivateRequestMemo, withRequestMemo } from '$server/db/request-memo';

if (!building && env.DESKTOP === '1') {
  const lifecycle = installWorkerLifecycle(process);
  const notifications = bootstrapNotificationWorker();
  if (notifications) lifecycle.add(notifications);
}

// Evaluated once per process (spec §2.1) — the Supabase connection target
// never changes for the life of this process.
const DEV_BACKEND = isDevBackend();

/**
 * Stamps locals.backend for EVERY request, first in the handle sequence, so
 * it's set even for requests other handles resolve early (well-known, i18n
 * redirects, …) and is available to the root layout load before login.
 */
const backendModeHandle: Handle = ({ event, resolve }) => {
  event.locals.backend = DEV_BACKEND ? 'dev' : 'prd';
  return resolve(event);
};

/**
 * Resolve the landing page for a signed-in user hitting "/". Defaults to
 * `/home`; honors the per-user `landingPage` preference (set via right-click →
 * "Set as home page" in the sidebar) and the per-user `locale` preference
 * (`{ tag }`, what the language toggle saves): the result is locale-prefixed
 * (`/es/home`), so a Spanish-speaking member lands in Spanish instead of the
 * unprefixed path falling to the default language (owner ask 2026-09-26:
 * "change their default language to spanish"). Best-effort — any lookup
 * failure falls back to the default so the root redirect never 500s.
 */
async function resolveLandingPage(supabaseId: string | undefined): Promise<string> {
  const DEFAULT = '/home';
  if (!supabaseId) return DEFAULT;
  const cached = getCachedLanding(supabaseId);
  if (cached) return cached;
  try {
    const prefs = await getUserPreferences(getCoreDb(), supabaseId);
    const tag = (prefs.locale as { tag?: unknown } | undefined)?.tag;
    const prefix =
      typeof tag === 'string' && (availableLanguageTags as readonly string[]).includes(tag)
        ? `/${tag}`
        : '';
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
      setCachedLanding(supabaseId, prefix + choice);
      return prefix + choice;
    }
    // Valid lookup with no (or an unsafe) home-page preference: cache the
    // (locale-prefixed) default so the common case stops re-querying PG.
    setCachedLanding(supabaseId, prefix + DEFAULT);
    return prefix + DEFAULT;
  } catch {
    /* fall through to default — and don't cache, so a transient PG error
       doesn't pin the default for the whole TTL */
    return DEFAULT;
  }
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
  const cloudPath = canonicalPath(event.url.pathname);
  if (cloudPath === '/cloud' || cloudPath.startsWith('/cloud/')) {
    response.headers.set(
      'Permissions-Policy',
      'publickey-credentials-get=(self "https://exe.dev" "https://*.exe.xyz")',
    );
  }
  return response;
};

const UNPROTECTED_PREFIXES = [
  '/login',
  '/api/',
  '/invite/',
  '/.well-known/',
  '/auth/',
  '/book',
  // Public doors (spec 041): /d/<slug> resolves its own org from the slug.
  '/d/',
];

/**
 * Carry the caller's selected build channel for the whole request (spec §D4).
 *
 * The browser mirrors its sessionStorage pick into a session cookie; everything
 * downstream — layout loads, API handlers, `gatewayCallAsUser` — reads it via
 * `currentBuildChannel()` so the browser's WS and the server's RPC resolve to
 * the SAME instance. Them choosing independently is what produced the all-day
 * intermittency.
 *
 * Anything unrecognised is `'prd'`. There is no input that yields `'dev'` other
 * than the literal string, and an org without a dev row still cannot reach one.
 */
const buildChannelHandle: Handle = ({ event, resolve }) => {
  const raw = event.cookies.get(BUILD_CHANNEL_COOKIE);
  const channel = isGatewayChannel(raw) ? raw : 'prd';
  event.locals.buildChannel = channel;
  return runWithBuildChannel(channel, () => resolve(event));
};

const appHandle: Handle = async ({ event, resolve }) => {
  // Identity resolution (provider selection + tenant context) lives in
  // $server/auth/resolve-identity. appHandle just applies the result and runs
  // the shared app gate — unless the provider opted out (AUTH_DISABLED and the
  // /api/metrics bearer path resolve directly, as before).
  const { locals, bypassGate } = await resolveIdentity(event);
  Object.assign(event.locals, locals);
  if (bypassGate) {
    // AUTH_DISABLED bypass skips finishApp, so mirror its "/" → landing redirect
    // here or the root URL 404s in dev (there is no +page at "/").
    if (canonicalPath(event.url.pathname) === '/') {
      return new Response(null, { status: 307, headers: { location: '/home' } });
    }
    // Bypass covers AUTHENTICATION only — module/kind availability still
    // applies, or auth-disabled dev reaches routes prod 404s (the per-route
    // guards this hook replaced are gone). The organization guard classifier keeps the
    // /api/metrics bearer bypass (no user / no (app) route id) out of it.
    await applyModuleAvailabilityGuard(event);
    await applyRouteAccessGuard(event);
    return resolve(event);
  }
  return finishApp({ event, resolve });
};

/**
 * Central route-policy guard (perf spec 2026-08-22 §S3). This lived in
 * `(app)/+layout.server.ts`, but reading `url.pathname` there made the ENTIRE
 * layout bundle (permissions, orgs, workspaces, hosts, prefs — 12-16 round
 * trips) re-run on every navigation just to re-check the policy. Hooks run on
 * every server request (pages, __data.json, actions), so the check is
 * equivalent while the layout load becomes navigation-independent.
 * Route-owned page guards remain defense in depth for load-less shells.
 */
async function applyRouteAccessGuard(event: Parameters<Handle>[0]['event']): Promise<void> {
  const user = event.locals.user;
  if (
    !shouldApplyOrganizationRouteGuards(
      Boolean(user),
      Boolean(event.locals.tenantCtx),
      event.route.id,
    )
  ) {
    return;
  }
  // shouldApplyOrganizationRouteGuards proves the user exists for this branch.
  if (!user) return;
  // Cached (2m) — the same resolver the layout bundle serves to the client.
  const permissions = await loadPermissionsForUser(event.locals, user.id);
  const granted = new Set(permissions.permissions);
  const routeAccess = decideRouteAccess(canonicalPath(event.url.pathname), {
    authenticated: true,
    role: user.role,
    permissions: granted,
    orgCapabilities: granted,
  });
  if (!routeAccess.allowed) {
    throw error(
      routeAccess.deniedStatus,
      routeAccess.deniedStatus === 404 ? 'Not found' : 'You do not have access to this module.',
    );
  }
}

/**
 * Module-availability guard for authenticated `(app)` page requests
 * (routing-simplification spec S2). Populates locals.moduleStates as a
 * per-request snapshot (one cached listModuleStates read — R3) that
 * data-bearing route loads also consume, then 404s if the resolved module is
 * kind-restricted or toggled off for this org.
 */
async function applyModuleAvailabilityGuard(event: Parameters<Handle>[0]['event']): Promise<void> {
  if (
    !shouldApplyOrganizationRouteGuards(
      Boolean(event.locals.user),
      Boolean(event.locals.tenantCtx),
      event.route.id,
    )
  ) {
    return;
  }
  const tenantId = event.locals.tenantCtx?.tenantId;
  if (!tenantId) return;
  const moduleStates = await listModuleStates({
    db: getCoreDb(),
    tenantId,
    profileId: event.locals.user?.supabaseId,
  });
  event.locals.moduleStates = moduleStates;
  if (
    isAppRouteBlocked(canonicalPath(event.url.pathname), {
      kind: event.locals.orgKind,
      moduleStates,
    })
  ) {
    throw error(404, 'Not found');
  }
}

/**
 * Shared tail for appHandle — runs after locals.user/tenantCtx have been set
 * (or left unset) by whichever auth branch handled the request. Both the
 * Better Auth path and the Supabase bridge path route through here so the
 * handler-owned API authentication + redirect logic isn't duplicated.
 */
const finishApp: Handle = async ({ event, resolve }) => {
  // Locale-blind: every comparison below assumes canonical (unprefixed) paths.
  const path = canonicalPath(event.url.pathname);

  // These public or separately authenticated handlers may run without a tenant.
  // Dispatch never supplies organization authority: tenant-scoped handlers must
  // reject the absent context, while enrollment and public reads can proceed.
  const API_HANDLER_AUTH_PATHS = [
    '/api/marketplace',
    '/api/registry',
    '/api/servers',
    '/api/metrics',
    '/api/gateway',
    '/api/device-identity',
    '/api/admin',
    // Self-serve join: a no-org (no tenantCtx) but authenticated user must be
    // able to POST a join request. Handlers enforce their own auth (requireAuth
    // / requireAdmin); dispatch does not grant an organization context.
    '/api/join-requests',
    '/api/gateways',
    // DEV-only user tools. The switcher must work for an authenticated user
    // with no active org; qa-login is intentionally anonymous before sign-in.
    // Each handler owns its exact DEV/loopback/auth/origin/rate-limit gates.
    '/api/dev',
    // Anonymous booking flow: /book/[slug] has no session/org context by
    // design. The read (slots) and write (book) handlers validate the slug
    // and booking payload themselves — see the RBAC write-guard comment below,
    // which already (correctly) excludes this same prefix from capability
    // checks; this tenant gate needs the matching exclusion.
    '/api/scheduling/public',
    // Anonymous door submissions (spec 041 S2: /api/doors/public/[slug]/submit).
    // The handler resolves the org from the slug and enforces its own rate
    // limit, honeypot and validation; no capability prefix maps here.
    '/api/doors/public',
  ];
  if (!event.locals.tenantCtx && path.startsWith('/api/')) {
    // Organization switching remains reachable after revocation; only this
    // exact handler owns the canonical membership check, not its descendants.
    const handlerOwnsAuth =
      path === '/api/active-org' ||
      API_HANDLER_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    if (handlerOwnsAuth) {
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
    if (isCronAuthPath(path)) {
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
    // Authentication alone does not establish an active organization.
    const authenticated = Boolean(event.locals.user);
    return new Response(
      JSON.stringify({
        error: authenticated
          ? 'No active organization for this request'
          : 'Authentication required',
      }),
      {
        status: authenticated ? 403 : 401,
        headers: { 'content-type': 'application/json' },
      },
    );
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

  // Module-availability guard (routing-simplification spec S2). Server-token/
  // cron requests never reach here (resolve-identity.ts's server-token
  // provider sets bypassGate:true — the AUTH_DISABLED bypass branch runs this
  // same guard itself); request classification is defense in depth on top of that.
  // Existing per-route pulse guards stay in place until this hook has soaked
  // (belt-and-suspenders).
  await applyModuleAvailabilityGuard(event);
  await applyRouteAccessGuard(event);

  // Central RBAC write guard: business-data + org-config mutating API calls
  // (/api/crm|finances|sales|scheduling|support|memberships|projects|work|
  // workforce|modules|plugins) require the matching capability. Reads aren't
  // gated here (pages gate their own view); only POST/PUT/PATCH/DELETE. The
  // gateway server-token + cron-tick traffic targets other prefixes, and the
  // anonymous /api/scheduling/public/* booking path is excluded — so only
  // user-driven writes reach this. 403 (JSON) when the role lacks the cap.
  if (event.locals.user) {
    const need = apiWriteCapability(path, event.request.method);
    if (need && !(await hasAnyCapability(event.locals, [need, ...(need.anyOf ?? [])]))) {
      return new Response(
        JSON.stringify({ error: 'You do not have permission to perform this action.' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  return resolve(event);
};

async function hasAnyCapability(
  locals: App.Locals,
  needs: ReadonlyArray<{ module: Module; action: PermAction }>,
): Promise<boolean> {
  for (const need of needs) {
    if (await hasOrgCapability(locals, need.module, need.action)) return true;
  }
  return false;
}

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
    const path = canonicalPath(event.url.pathname);
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

// Server-side error tracking. No-op until SENTRY_DSN is set — hub + site had NO
// Sentry (only the gateway did), so hub server crashes were invisible; this
// closes that gap. Client errors still go to PostHog captureException. Upgrade
// path: move init to instrumentation.server.ts + add sentrySvelteKit() to
// vite.config for source maps + full request tracing.
// OBS-01: a validated commit sha or nothing. Never a package version or NODE_ENV
// standing in for a release — an invented release makes every event
// unattributable to the code that produced it.
const sentryRelease = releaseContext().release;

Sentry.init({
  dsn: env.SENTRY_DSN,
  beforeSend: redactGatewayCredential,
  beforeSendTransaction: redactGatewayCredential,
  enabled: !!env.SENTRY_DSN,
  release: sentryRelease === UNKNOWN ? undefined : sentryRelease,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ? Number(env.SENTRY_TRACES_SAMPLE_RATE) : 0.1,
  environment: env.PUBLIC_VERCEL_ENV ?? env.NODE_ENV ?? 'development',
});

/**
 * Opens the AI usage scope for the request. Must sit at the FRONT of the
 * sequence: the scope has to exist before any downstream handle or endpoint can
 * resolve a tenant into it, and before any LLM call can read it. The org id is
 * still null here — authentication has not run yet — and gets filled in later by
 * `getTenantCtx`. See `$server/ai-usage`.
 */
const aiUsageScopeHandle: Handle = ({ event, resolve }) =>
  runWithAiUsageScope({ orgId: null, route: event.route.id, feature: null }, () => resolve(event));

// Route-level request telemetry. Sits right behind the AI-usage scope so it
// measures the whole downstream chain (auth, module guard, load). PostHog
// capture is fire-and-forget; org-scoped monitor persistence uses waitUntil.
const serverTimingHandle = createServerTimingHandle({
  sampleRate: env.SERVER_TIMING_SAMPLE_RATE ? Number(env.SERVER_TIMING_SAMPLE_RATE) : 0.1,
  capture: (eventName, properties, orgId) => {
    captureServerEvent({
      event: eventName,
      distinctId: orgId ? `org:${orgId}` : 'server',
      properties,
    });
  },
  persist: (orgId, sample) => {
    waitUntil(storePerformanceSample(orgId, sample));
  },
});

const cacheDataPlaneHandle: Handle = async ({ event, resolve }) => {
  await initCacheDataPlane();
  return resolve(event);
};

const workerRequestHandle: Handle = ({ event, resolve }) =>
  !building && env.DESKTOP === '1'
    ? trackWorkerRequest(Promise.resolve(resolve(event)))
    : resolve(event);

// HUB_SQL_TRACE=1 only (brief-debloat-b §1): wraps every downstream handle +
// load so DB calls made anywhere in the request are counted against this
// route. No-op (no AsyncLocalStorage.run) when the env var is unset.
const sqlTraceHandle: Handle = ({ event, resolve }) =>
  runWithSqlTrace(event.route.id ?? event.url.pathname, async () => resolve(event));

/**
 * Routes whose GET loads may share ONE org transaction. A cold
 * `/pos/catalog` page-data request opened 38 of them (BEGIN + set_config +
 * COMMIT each), ~115 trivial round trips and 38 Supavisor checkouts around
 * ~46 real statements — unaffordable on the Micro's CPU credits.
 *
 * Route IDs, not paths: locale prefixes and the `/__data.json` suffix are
 * already stripped by the time a handle runs.
 */
function sharesOrgTransaction(routeId: string | null): boolean {
  if (!routeId) return false;
  return (
    routeId === '/(app)/pos' || routeId.startsWith('/(app)/pos/') || routeId.startsWith('/api/pos/')
  );
}

/**
 * Opens one org-scoped transaction per POS GET request and makes it ambient,
 * so every `withOrgCore` call in the load tree joins it instead of opening its
 * own (see `$server/db/ambient-org-tx`). GETs only: a write must keep owning
 * its own transaction boundary. Verified (2026-10-12) that no POS
 * `+page.server.ts`/`+layout.server.ts` load and no `/api/pos/*` GET handler
 * awaits a `fetch`, a gateway RPC or a sleep, so the transaction never idles
 * on a slow remote call (cache lookups are the one remaining non-DB await —
 * see (2) below).
 *
 * TODO(handoff): two known limits of sharing one transaction across a load
 * tree. (1) A WRITE performed by a joined GET load is rolled back when a LATER
 * sibling statement fails — reads retry on a private transaction, writes do
 * not. No POS GET load writes today; a future one must open its own
 * transaction. (2) `cached()` lookups still run between the joined statements,
 * so with CACHE_BACKEND=valkey the shared transaction is briefly idle on a
 * cache round trip (ms, against the 20s idle_in_transaction guard) where it
 * previously was closed. Open ends are listed in the `perf/debloat-d` PR body.
 */
const ambientOrgTxHandle: Handle = async ({ event, resolve }) => {
  const tenantId = event.locals.tenantCtx?.tenantId;
  if (event.request.method !== 'GET' || !tenantId || !sharesOrgTransaction(event.route.id)) {
    return resolve(event);
  }
  const profileId = event.locals.user?.supabaseId ?? null;
  let pending: Promise<Response> | undefined;
  try {
    await getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
      await applyOrgTxScope(tx, tenantId, profileId);
      const shared = createAmbientOrgTx(tx, tenantId, profileId);
      try {
        pending = Promise.resolve(shared.run(() => resolve(event)));
        // Settle on the response — or earlier, when a `withOrgCore` call had
        // to abandon this transaction to run its own (scope mismatch, or a
        // failed statement aborted it).
        await Promise.race([pending.then(swallow, swallow), shared.releaseRequested]);
        // An aborted transaction must never be committed.
        if (shared.ambient.poisoned) shared.ambient.tx.rollback();
      } finally {
        shared.ambient.closed = true;
        shared.markEnded();
      }
    });
  } catch (err) {
    // Rollback (poisoned or released). The response is built independently of
    // this transaction's outcome and its reads already handled their own
    // failures, so serve it rather than 500 a rendered page.
    if (!pending) throw err;
  }
  // Unreachable: a missing `pending` means the transaction threw before
  // `resolve` ran, which the catch above rethrows.
  if (!pending) throw new Error('shared org transaction ended without a response');
  return pending;
};

function swallow(): void {}

// GET/HEAD only (brief-debloat-c §2): activates request-scoped memoisation
// (src/server/db/request-memo.ts) for idempotent org reads (pos_settings,
// fin_settings, warehouses, tag links, …) that are otherwise re-fetched 2-4×
// per page by independent service calls within one request. A write
// (POST/PUT/PATCH/DELETE) must always read its own writes fresh — it never
// activates the store, so memoRequest() is a no-op passthrough for every
// write handler, identical to pre-memoisation behavior.
const requestMemoHandle: Handle = ({ event, resolve }) =>
  shouldActivateRequestMemo(event.request.method)
    ? withRequestMemo(async () => resolve(event))
    : resolve(event);

export const handle = sequence(
  sqlTraceHandle,
  requestMemoHandle,
  planOperationCacheHandle,
  backendModeHandle,
  workerRequestHandle,
  aiUsageScopeHandle,
  serverTimingHandle,
  cacheDataPlaneHandle,
  Sentry.sentryHandle(),
  i18n.handle(),
  cloudPasskeyHandle,
  posthogProxyHandle,
  wellKnownHandle,
  buildChannelHandle,
  appHandle,
  workforceIdentityHandle,
  // Innermost: it needs the tenant/profile appHandle resolved, and it should
  // wrap nothing but the route's own load/endpoint work.
  ambientOrgTxHandle,
);

import type { HandleServerError } from '@sveltejs/kit';

const serverErrorHandler: HandleServerError = ({ error, event, status }) => {
  // Server log keeps the full error: it stays on the host, unlike telemetry.
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  // OBS-01: the event carries sanitized execution identity (org/actor/request/
  // trace/agent-run ids, route TEMPLATE, release) and a digest of the message
  // — never the message itself, which routinely embeds SQL, tokens, headers or
  // customer rows. See $lib/server/observability-context.
  //
  // Everything below is synchronous and total: an unguarded await or throw in a
  // hook turns one failing request into a failing subtree. `captureServerEvent`
  // is fire-and-forget with a non-blocking flush (M8 batching preserved).
  try {
    const identity = requestIdentity({
      routeId: event.route.id,
      method: event.request.method,
      headers: event.request.headers,
      locals: event.locals,
    });
    captureServerEvent({
      event: 'server_error',
      distinctId: distinctIdFor(identity),
      properties: sanitizeErrorProperties({ error, status, identity }),
      flush: true,
    });
  } catch {
    // Telemetry must never mask the original error.
  }
  return { message: 'Internal Error' };
};

// Wrap so exceptions also reach Sentry (no-op without a DSN); the PostHog
// capture inside stays as the product-analytics record.
export const handleError = Sentry.handleErrorWithSentry(serverErrorHandler);

// One-time cache initialization.
void initCache().catch((err) => console.error('[cache] init failed', err));
