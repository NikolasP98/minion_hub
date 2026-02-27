import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { i18n } from '$lib/i18n';
import { auth } from '$lib/auth';
import { getDb } from '$server/db/client';
import { servers, organization } from '$server/db/schema';
import { decryptToken } from '$server/auth/crypto';

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

const appHandle: Handle = async ({ event, resolve }) => {
  // /api/auth/* — Better Auth handles via its catch-all route, no hook action needed
  if (event.url.pathname.startsWith('/api/auth/')) {
    return resolve(event);
  }

  // Server token auth for metrics push endpoints (Bearer token)
  if (event.url.pathname.startsWith('/api/metrics/')) {
    const authHeader = event.request.headers.get('authorization');
    const serverAuth = await resolveServerTokenAuth(authHeader);
    if (serverAuth) {
      const db = getDb();
      event.locals.tenantCtx = { db, tenantId: serverAuth.tenantId };
      (event.locals as Record<string, unknown>).serverId = serverAuth.serverId;
      return resolve(event);
    }
    // Fall through to cookie/session auth for browser-originated metric reads
  }

  // Session auth via Better Auth
  const betterAuthSession = await auth.api.getSession({ headers: event.request.headers });
  if (betterAuthSession) {
    event.locals.user = {
      id: betterAuthSession.user.id,
      email: betterAuthSession.user.email,
      displayName: betterAuthSession.user.name ?? null,
    };
    event.locals.session = betterAuthSession.session;

    const orgId = betterAuthSession.session.activeOrganizationId ?? undefined;
    event.locals.orgId = orgId;

    if (orgId) {
      const db = getDb();
      event.locals.tenantCtx = { db, tenantId: orgId };
    }
  }

  // Unauthenticated fallback: resolve first organization in DB for local usage
  if (!event.locals.tenantCtx) {
    const db = getDb();
    const rows = await db.select({ id: organization.id }).from(organization).limit(1);
    if (rows.length > 0) {
      event.locals.tenantCtx = { db, tenantId: rows[0].id };
    }
  }

  return resolve(event);
};

export const handle = sequence(i18n.handle(), appHandle);

import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  return { message: 'Internal Error' };
};
