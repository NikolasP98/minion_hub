import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { gatewayHeartbeats, servers, userServers } from '@minion-stack/db/schema';
import { requireAuth, requireTenantCtx } from '$server/auth/authorize';
import { userHasGatewayAccess } from '$server/services/gateway.pg.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const { db, tenantId } = requireTenantCtx(locals);
  const user = requireAuth(locals);
  const serverId = url.searchParams.get('serverId') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;

  // The gateway records heartbeats under the tenant_id it reads from the telemetry
  // `servers` table (turso-sync auto-discovers `SELECT tenant_id FROM servers
  // WHERE id = serverId`). That id can differ from the hub's Supabase org id
  // (Turso↔Supabase divergence), so we read under the host's recorded telemetry
  // tenant. Because that bypasses the org-scoped read, we FIRST authorize the
  // caller for this host the canonical way (admin / Supabase user_gateway link /
  // legacy user_servers) — mirroring api/servers/[id] — so a forged serverId
  // can't pull another tenant's heartbeats. (We must NOT gate on
  // servers.tenant_id == tenantId, which no-ops under the divergence.)
  let heartbeatTenant = tenantId;
  if (serverId) {
    const allowed =
      user.role === 'admin' ||
      (await userHasGatewayAccess(user.supabaseId ?? null, serverId)) ||
      (
        await db
          .select({ serverId: userServers.serverId })
          .from(userServers)
          .where(and(eq(userServers.userId, user.id), eq(userServers.serverId, serverId)))
          .limit(1)
      ).length > 0;
    if (!allowed) return json({ error: 'Not found' }, { status: 404 });

    const [row] = await db
      .select({ tenantId: servers.tenantId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (row?.tenantId) heartbeatTenant = row.tenantId;
  }

  const conditions = [eq(gatewayHeartbeats.tenantId, heartbeatTenant)];
  if (serverId) conditions.push(eq(gatewayHeartbeats.serverId, serverId));
  if (from) conditions.push(gte(gatewayHeartbeats.capturedAt, from));
  if (to) conditions.push(lte(gatewayHeartbeats.capturedAt, to));

  const heartbeats = await db
    .select()
    .from(gatewayHeartbeats)
    .where(and(...conditions))
    .orderBy(desc(gatewayHeartbeats.capturedAt))
    .limit(limit);

  return json({ heartbeats });
};
