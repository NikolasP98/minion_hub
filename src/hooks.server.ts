import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { i18n } from '$lib/i18n';
import { getAuth } from '$lib/auth/auth';
import { building } from '$app/environment';
import { getDb } from '$server/db/client';
import { servers, organization, user as userTable } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '$server/auth/crypto';
import { env } from '$env/dynamic/private';
import { startBackupScheduler } from '$server/services/backup-scheduler';
import { ensurePersonalAgentOnLogin } from '$server/services/personal-agent.service';

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

const UNPROTECTED_PREFIXES = ['/login', '/api/', '/invite/', '/.well-known/'];

const appHandle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // AUTH_DISABLED: skip all auth, resolve first org for API routes to work
  if (env.AUTH_DISABLED === 'true') {
    const db = getDb();
    const rows = await db.select({ id: organization.id }).from(organization).limit(1);
    if (rows.length > 0) event.locals.tenantCtx = { db, tenantId: rows[0].id };
    event.locals.user = { id: 'local', email: 'local@dev', displayName: 'Local Dev', role: 'admin' };
    return resolve(event);
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

  // Session auth via Better Auth
  let betterAuthSession = null;
  try {
    betterAuthSession = await getAuth().api.getSession({ headers: event.request.headers });
  } catch (err) {
    console.error('[hooks] getSession failed, treating as unauthenticated:', err);
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
    const orgId = (betterAuthSession.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? undefined;
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
          userName: betterAuthSession.user.name ?? '',
          serverId: '',
        },
      ).catch((err) => console.error('[personal-agent] Login backfill failed:', err));
    }
  }

  // For API routes: unauthenticated fallback to first org (preserve existing behaviour)
  if (!event.locals.tenantCtx && path.startsWith('/api/')) {
    const db = getDb();
    const rows = await db.select({ id: organization.id }).from(organization).limit(1);
    if (rows.length > 0) event.locals.tenantCtx = { db, tenantId: rows[0].id };
    return resolve(event);
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

  return resolve(event);
};

export const handle = sequence(i18n.handle(), authHandle, appHandle);

import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  return { message: 'Internal Error' };
};

startBackupScheduler();
