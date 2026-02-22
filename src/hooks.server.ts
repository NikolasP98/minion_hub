import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { i18n } from '$lib/i18n';
import { getDb } from '$server/db/client';
import { servers, tenants } from '$server/db/schema';
import { validateSession, SESSION_COOKIE } from '$server/auth/session';
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
  // Skip auth for auth routes and public assets
  if (event.url.pathname.startsWith('/api/auth/')) {
    return resolve(event);
  }

  // Server token auth for metrics push endpoints (Bearer token)
  if (event.url.pathname.startsWith('/api/metrics/')) {
    const auth = event.request.headers.get('authorization');
    const serverAuth = await resolveServerTokenAuth(auth);
    if (serverAuth) {
      const db = getDb();
      event.locals.tenantCtx = { db, tenantId: serverAuth.tenantId };
      // Store serverId for metrics endpoints
      (event.locals as Record<string, unknown>).serverId = serverAuth.serverId;
      return resolve(event);
    }
    // Fall through to cookie auth for browser-originated metric reads
  }

  const token = event.cookies.get(SESSION_COOKIE);

  if (token) {
    const db = getDb();
    const session = await validateSession(db, token);

    if (session) {
      event.locals.user = session.user;
      event.locals.role = session.role as App.Locals['role'];

      if (session.tenantId) {
        event.locals.tenantCtx = {
          db,
          tenantId: session.tenantId,
        };
      }
    }
  }

  // Unauthenticated fallback: resolve first tenant in DB for local usage
  if (!event.locals.tenantCtx) {
    const db = getDb();
    const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
    if (rows.length > 0) {
      event.locals.tenantCtx = { db, tenantId: rows[0].id };
    }
  }

  return resolve(event);
};

export const handle = sequence(i18n.handle(), appHandle);
