import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { servers, userServers } from '@minion-stack/db/schema';
import { computeInsights } from '$server/services/insights.service';
import { requireAuth, requireTenantCtx } from '$server/auth/authorize';
import { userHasGatewayAccess } from '$server/services/gateway.pg.service';

const DAY = 86_400_000;

/**
 * Reliability INSIGHTS — ranked, evidence-backed proposed actions derived from the
 * hub-owned `unified_events` corpus. Read-only. One round trip returns the payload.
 *
 * `unified_events` is stamped with the tenant the GATEWAY reads from the telemetry
 * `servers` table (turso-sync auto-discovers `SELECT tenant_id FROM servers WHERE
 * id = serverId`); that id can differ from the hub's Supabase org id (Turso↔Supabase
 * divergence). So we scope by the HOST's recorded telemetry tenant, NOT the viewer's
 * org — but first authorize the caller for this host the canonical way (admin /
 * Supabase gateway link / legacy user_servers) so a forged serverId can't read
 * another tenant's telemetry. Mirrors /api/metrics/gateway-heartbeats.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const { db, tenantId } = requireTenantCtx(locals);
  const user = requireAuth(locals);

  const serverId = url.searchParams.get('serverId') ?? undefined;
  if (!serverId) return json({ insights: null });

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
  if (!allowed) return json({ insights: null }, { status: 404 });

  // Read under the host's recorded telemetry tenant (NOT servers.tenant_id ==
  // tenantId, which no-ops under the divergence).
  const [row] = await db
    .select({ tenantId: servers.tenantId })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);
  const scopeTenant = row?.tenantId ?? tenantId;

  const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : Date.now();
  const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : to - 7 * DAY;

  const insights = await computeInsights({ db, tenantId: scopeTenant }, serverId, { from, to });
  return json({ insights });
};
