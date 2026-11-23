import { eq } from 'drizzle-orm';
import { servers } from '@minion-stack/db/schema';
import type { TenantContext } from '$server/services/base';
import { gatewayBelongsToOrg, resolveGatewayId } from '$server/services/gateway.pg.service';

/**
 * Who owns `serverId` relative to the caller's legacy tenant context:
 * `own` (bridged gateway or legacy `servers` row is in the caller's org),
 * `foreign` (it exists but belongs to someone else, or a gateway token names a
 * different server), `none` (no such server anywhere).
 *
 * Same resolution order as `assertOwnsOrAdmin` in `/api/servers/[id]/+server.ts`:
 * the Supabase gateway registry is authoritative when the id is bridged, else
 * the legacy Turso row's `tenantId`. A gateway server token (`locals.serverId`)
 * may only act on its own server. Routes answer 404 for anything but `own` so a
 * foreign id is indistinguishable from a missing one.
 */
export async function serverScope(
  ctx: TenantContext,
  serverId: string,
  tokenServerId?: string,
): Promise<'own' | 'foreign' | 'none'> {
  if (tokenServerId && tokenServerId !== serverId) return 'foreign';
  if (await resolveGatewayId(serverId)) {
    return (await gatewayBelongsToOrg(serverId, ctx.tenantId)) ? 'own' : 'foreign';
  }
  const [row] = await ctx.db
    .select({ tenantId: servers.tenantId })
    .from(servers)
    .where(eq(servers.id, serverId));
  if (!row) return 'none';
  return row.tenantId === ctx.tenantId ? 'own' : 'foreign';
}
