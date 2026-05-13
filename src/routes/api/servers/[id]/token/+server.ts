import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { userServers } from '@minion-stack/db/schema';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getServerToken } from '$server/services/server.service';

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
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) return json({ error: 'No tenant context' }, { status: 403 });

  const id = params.id!;

  if (user.role !== 'admin') {
    const [link] = await ctx.db
      .select({ serverId: userServers.serverId })
      .from(userServers)
      .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, id)));
    if (!link) return json({ error: 'Not found' }, { status: 404 });
  }

  const token = await getServerToken(ctx, id);
  if (token === null) return json({ error: 'Not found' }, { status: 404 });

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
