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
}

export async function getCoreCtx(locals: App.Locals): Promise<CoreCtx | null> {
  const base = await getTenantCtx(locals);
  if (!base) return null;
  return { db: getCoreDb(), tenantId: base.tenantId };
}

/**
 * Server-scoped core context: CoreCtx + the resolved `gatewayId`. For domains
 * whose pg rows key on `gateway_id` (settings, channels, builder, skills,
 * sessions, server-ops, …). The `serverId` is the legacy Turso server id from
 * the `/api/servers/[id]/*` route param; it's resolved to the Supabase
 * gateway.id via `resolveGatewayId` (gateway.legacy_server_id bridge).
 *
 * Returns null if there's no tenant or no gateway bridges that serverId.
 */
export interface ServerCtx extends CoreCtx {
  gatewayId: string;
}

export async function getServerCtx(
  locals: App.Locals,
  serverId: string,
): Promise<ServerCtx | null> {
  const base = await getCoreCtx(locals);
  if (!base) return null;
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;
  return { ...base, gatewayId };
}
