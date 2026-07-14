import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { userServers } from '@minion-stack/db/schema';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getServerToken } from '$server/services/server.service';
import {
  userHasGatewayAccess,
  getGatewayTokenByServerId,
} from '$server/services/gateway.pg.service';

/**
 * Returns the decrypted gateway token for a single server.
 *
 * Always requires an authenticated session — no unauthenticated fallback.
 * This is the only legitimate place a token leaves the server. Tokens are
 * never returned by `GET /api/servers` and never persisted to localStorage.
 *
 * POST (not GET) to keep tokens out of browser history, referer headers,
 * proxy access logs, and the default HTTP cache.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  console.log(
    '[token-ep] ENTRY user=',
    locals.user?.email ?? 'NONE',
    'role=',
    locals.user?.role,
    'id=',
    params.id,
  );
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) {
    console.log('[token-ep] no tenant ctx -> 403');
    return json({ error: 'No tenant context' }, { status: 403 });
  }
  console.log('[token-ep] tenant=', ctx.tenantId);

  const id = params.id!;

  if (user.role !== 'admin') {
    // Access source of truth = Supabase user_gateway (by profile uuid); fall
    // back to the legacy Turso user_servers link during bake-in so no one loses
    // access mid-cutover.
    const allowed =
      (await userHasGatewayAccess(user.supabaseId ?? null, id)) ||
      (await ctx.db
        .select({ serverId: userServers.serverId })
        .from(userServers)
        .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, id)))
        .then((rows) => rows.length > 0));
    if (!allowed) {
      console.log('[token-ep] non-admin without link -> 404');
      return json({ error: 'Not found' }, { status: 404 });
    }
  }

  // Try Supabase gateway table first (post-cutover source of truth), then fall
  // back to Turso servers table for legacy rows that haven't migrated yet.
  let token: string | null = null;
  let registryError: unknown = null;
  try {
    token = await getGatewayTokenByServerId(id);
  } catch (err) {
    registryError = err;
    console.warn('[token-ep] Supabase gateway lookup threw (will try Turso):', err);
  }
  if (!token) {
    try {
      token = await getServerToken(ctx, id);
    } catch (err) {
      console.error('[token-ep] getServerToken threw:', err);
      return json(
        { error: 'decrypt failed', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }
  if (token === null) {
    // A PG outage is not evidence that the gateway row is absent. Returning a
    // 404 here made pool exhaustion look like a missing token and prevented the
    // browser's gateway client from reconnecting after the database recovered.
    if (registryError) {
      return json(
        { error: 'Gateway registry temporarily unavailable' },
        { status: 503, headers: { 'retry-after': '2' } },
      );
    }
    console.log('[token-ep] token not found in Supabase or Turso -> 404');
    return json({ error: 'Not found' }, { status: 404 });
  }
  console.log('[token-ep] OK token len=', token.length);

  return json(
    { token },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache',
      },
    },
  );
};
