import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$server/services/server.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import { userServers } from '@minion-stack/db/schema';
import { and, eq } from 'drizzle-orm';

/** Non-admins must be linked to the server via `user_servers`. */
async function assertOwnsOrAdmin(
  ctx: import('$server/services/base').TenantContext,
  user: { id: string; role: 'user' | 'admin' },
  serverId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const [link] = await ctx.db
    .select({ serverId: userServers.serverId })
    .from(userServers)
    .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, serverId)));
  return !!link;
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const id = params.id!;
    if (!(await assertOwnsOrAdmin(ctx, user, id))) {
      return json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();
    await upsertServer(ctx, { id, name: '', url: '', ...body }, user.id);
    return json({ ok: true });
  } catch (e) {
    console.error(`[PUT /api/servers/${params.id}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const id = params.id!;
    if (!(await assertOwnsOrAdmin(ctx, user, id))) {
      return json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    await deleteServer(ctx, id);
    return json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/servers/${params.id}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
