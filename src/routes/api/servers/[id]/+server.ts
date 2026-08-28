import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { updateServer, deleteServer } from '$server/services/server.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import { servers, userServers } from '@minion-stack/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  userHasGatewayAccess,
  gatewayBelongsToOrg,
  resolveGatewayId,
} from '$server/services/gateway.pg.service';

type AccessResult = { ok: true } | { ok: false; status: 404 | 503 };

/**
 * Trust boundary for PUT/DELETE. Admin is NOT an org-wide exemption — an admin
 * of tenant A must not be able to mutate tenant B's server by supplying its id
 * (that was the open IDOR: this used to `return true` for any admin before any
 * check of the target server at all).
 *
 * `serverId` may or may not be bridged into the Supabase `gateway` registry yet
 * (spec 2026-08-18 cutover; `POST /api/servers` still only writes Turso, so a
 * freshly-added host is unbridged until a later migration step). Bridged rows
 * are authoritatively org-scoped there via `gatewayBelongsToOrg` — mirroring
 * `/api/servers/[id]/token`, and failing closed (404/503) rather than falling
 * through to Turso, because unlike that read path `updateServer`'s own WHERE
 * clause is not tenant-scoped (see its doc comment).
 *
 * Every mutation also requires the Turso row to belong to `ctx.tenantId`. This
 * closes a bridge-drift edge case where a gateway assignment and its legacy
 * Turso row temporarily disagree: the route must satisfy both authorities
 * before it calls the still-id-only `updateServer` mutation. A legacy
 * un-re-keyed row therefore denies with 404 instead of silently no-oping.
 *
 * Admins stop after those org and tenant checks. Non-admins additionally need
 * their existing personal link: Supabase `user_gateway` for bridged rows, or
 * the legacy Turso `user_servers` link for unbridged rows during bake-in.
 */
async function assertOwnsOrAdmin(
  ctx: import('$server/services/base').TenantContext,
  user: { id: string; role: 'user' | 'admin'; supabaseId?: string },
  orgId: string | null,
  serverId: string,
): Promise<AccessResult> {
  let gatewayId: string | null = null;
  try {
    gatewayId = await resolveGatewayId(serverId);
  } catch (err) {
    console.warn(`[servers/${serverId}] gateway registry lookup failed`, err);
    return { ok: false, status: 503 };
  }

  if (gatewayId) {
    try {
      if (!(await gatewayBelongsToOrg(serverId, orgId))) {
        return { ok: false, status: 404 };
      }
    } catch (err) {
      console.warn(`[servers/${serverId}] gateway org-scope lookup failed`, err);
      return { ok: false, status: 503 };
    }
  }

  const [tenantRow] = await ctx.db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, ctx.tenantId)));
  if (!tenantRow) return { ok: false, status: 404 };

  if (user.role === 'admin') return { ok: true };

  if (gatewayId) {
    try {
      return (await userHasGatewayAccess(user.supabaseId ?? null, serverId))
        ? { ok: true }
        : { ok: false, status: 404 };
    } catch (err) {
      console.warn(`[servers/${serverId}] gateway user-scope lookup failed`, err);
      return { ok: false, status: 503 };
    }
  }

  const [link] = await ctx.db
    .select({ serverId: userServers.serverId })
    .from(userServers)
    .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, serverId)));
  return link ? { ok: true } : { ok: false, status: 404 };
}

function accessDeniedResponse(access: Extract<AccessResult, { ok: false }>) {
  return json(
    {
      ok: false,
      error: access.status === 503 ? 'Gateway registry temporarily unavailable' : 'Not found',
    },
    { status: access.status },
  );
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const id = params.id!;
    const orgId = locals.orgId ?? ctx.tenantId ?? null;
    const access = await assertOwnsOrAdmin(ctx, user, orgId, id);
    if (!access.ok) return accessDeniedResponse(access);
    const body = await request.json();
    const updatedId = await updateServer(ctx, id, body);
    if (!updatedId) {
      return json({ ok: false, error: 'Not found' }, { status: 404 });
    }
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
    const orgId = locals.orgId ?? ctx.tenantId ?? null;
    const access = await assertOwnsOrAdmin(ctx, user, orgId, id);
    if (!access.ok) return accessDeniedResponse(access);
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
