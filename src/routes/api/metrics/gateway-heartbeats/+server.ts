import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { gatewayHeartbeats, servers } from '@minion-stack/db/schema';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, url }) => {
  const { db, tenantId } = requireTenantCtx(locals);
  const serverId = url.searchParams.get('serverId') ?? undefined;
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;

  // The gateway records heartbeats under the tenant_id it reads from the telemetry
  // `servers` table (turso-sync auto-discovers `SELECT tenant_id FROM servers
  // WHERE id = serverId`). That id can differ from the hub's Supabase org id
  // (Turso↔Supabase divergence), which previously left this query empty ("No
  // heartbeat data"). Resolve the host's recorded telemetry tenant so the read
  // matches the write; fall back to the request tenant when the host is unknown.
  let heartbeatTenant = tenantId;
  if (serverId) {
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
