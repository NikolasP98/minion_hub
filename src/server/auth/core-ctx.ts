import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { userGateway } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { resolveGatewayId } from '$server/services/gateway.pg.service';

/**
 * Core (Supabase-Postgres) tenant context: the relational-core db handle +
 * the resolved org (tenant) id. The generic equivalent of `getFlowsCtx` /
 * `getNotesCtx`, for any tenant-scoped domain whose storage has moved off
 * Turso onto Supabase (`@minion-stack/db/pg`).
 *
 * tenant_id on the pg rows is a cross-DB reference to the org id resolved from
 * Turso by `getTenantCtx` — valid because the canonical org id is shared across
 * both stores (same pattern as flows / notes).
 */
export interface CoreCtx {
  db: ReturnType<typeof getCoreDb>;
  tenantId: string;
  profileId?: string;
}

export async function getCoreCtx(locals: App.Locals): Promise<CoreCtx | null> {
  const base = await getTenantCtx(locals);
  if (!base) return null;
  return { db: getCoreDb(), tenantId: base.tenantId, profileId: locals.user?.supabaseId };
}

/** getCoreCtx, but throws a 401 instead of returning null. Mirrors requireTenantCtx. */
export async function requireCoreCtx(locals: App.Locals): Promise<CoreCtx> {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  return ctx;
}

/**
 * Server-scoped core context: CoreCtx + the resolved `gatewayId`. For domains
 * whose pg rows key on `gateway_id` (settings, channels, builder, skills,
 * sessions, server-ops, …). The `serverId` is the legacy Turso server id from
 * the `/api/servers/[id]/*` route param; it's resolved to the Supabase
 * gateway.id via `resolveGatewayId` (gateway.legacy_server_id bridge).
 *
 * Returns null if there's no tenant, no gateway bridges that serverId, or the
 * caller is not linked to that gateway.
 *
 * SECURITY: the serverId→gatewayId mapping is global, so we MUST verify the
 * caller may access the resolved gateway — otherwise a user could pass another
 * tenant's serverId and operate on its gateway-scoped rows (IDOR). The `gateway`
 * table has no tenant_id; access is governed by `user_gateway` links (which
 * mirror the legacy Turso `user_servers`). The id-mapping cache inside
 * `resolveGatewayId` is safe to keep global because it is not secret — this
 * ownership check is per-request and never cached.
 */
export interface ServerCtx extends CoreCtx {
  gatewayId: string;
  /** The original (legacy Turso) server id from the route param — preserved so
   *  services can echo it in API responses where the client keys by serverId. */
  serverId: string;
}

export async function getServerCtx(
  locals: App.Locals,
  serverId: string,
): Promise<ServerCtx | null> {
  const base = await getCoreCtx(locals);
  if (!base) return null;
  const profileId = locals.user?.supabaseId;
  if (!profileId) return null;
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;
  // Ownership gate: the caller must be linked to this gateway.
  const [link] = await getCoreDb()
    .select({ gatewayId: userGateway.gatewayId })
    .from(userGateway)
    .where(and(eq(userGateway.profileId, profileId), eq(userGateway.gatewayId, gatewayId)))
    .limit(1);
  if (!link) return null;
  return { ...base, gatewayId, serverId };
}
