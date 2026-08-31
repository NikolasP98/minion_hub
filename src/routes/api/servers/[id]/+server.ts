import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { updateServer, deleteServer } from '$server/services/server.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { requireAuth } from '$server/auth/authorize';
import { servers, userServers } from '@minion-stack/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  deleteGatewayForOrgByServerId,
  userHasGatewayAccess,
  gatewayBelongsToOrg,
  resolveGatewayId,
  updateGatewayForOrgByServerId,
} from '$server/services/gateway.pg.service';

type AccessResult = { ok: true; gatewayId: string | null } | { ok: false; status: 404 | 503 };

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
 * Bridged rows mutate canonical Postgres directly. Requiring a second Turso row
 * after the gateway cutover made every successful WebSocket connection emit a
 * 404 while reads and token issuance succeeded from Postgres. Legacy unbridged
 * rows retain the Turso tenant and personal-link checks below.
 *
 * Admins stop after the authoritative scope check for that storage plane.
 * Non-admins additionally need their existing personal link: Supabase
 * `user_gateway` for bridged rows, or the legacy Turso `user_servers` link for
 * unbridged rows during bake-in.
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
    if (user.role === 'admin') return { ok: true, gatewayId };
    try {
      return (await userHasGatewayAccess(user.supabaseId ?? null, serverId))
        ? { ok: true, gatewayId }
        : { ok: false, status: 404 };
    } catch (err) {
      console.warn(`[servers/${serverId}] gateway user-scope lookup failed`, err);
      return { ok: false, status: 503 };
    }
  }

  const [tenantRow] = await ctx.db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, ctx.tenantId)));
  if (!tenantRow) return { ok: false, status: 404 };

  if (user.role === 'admin') return { ok: true, gatewayId: null };

  const [link] = await ctx.db
    .select({ serverId: userServers.serverId })
    .from(userServers)
    .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, serverId)));
  return link ? { ok: true, gatewayId: null } : { ok: false, status: 404 };
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
    const updatedId = access.gatewayId
      ? orgId
        ? await updateGatewayForOrgByServerId(id, orgId, body)
        : null
      : await updateServer(ctx, id, body);
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
    if (access.gatewayId) {
      if (!orgId || !(await deleteGatewayForOrgByServerId(id, orgId))) {
        return json({ ok: false, error: 'Not found' }, { status: 404 });
      }
    } else {
      await deleteServer(ctx, id);
    }
    return json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/servers/${params.id}]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
