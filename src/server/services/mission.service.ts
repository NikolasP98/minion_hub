import { eq, and, desc } from 'drizzle-orm';
import { missions } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId, resolveServerId } from '$server/services/gateway.pg.service';

export interface MissionInput {
  serverId: string;
  sessionId: string;
  title: string;
  description?: string;
  metadata?: string;
}

// pg keys on gateway_id + Date timestamps; this service keeps the Turso-era
// public shape (serverId echoed, epoch-number timestamps).
type MissionRow = typeof missions.$inferSelect;

function reshape(row: MissionRow, serverId: string) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId,
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function createMission(ctx: CoreCtx, input: MissionInput) {
  const gatewayId = await resolveGatewayId(input.serverId);
  if (!gatewayId) throw new Error(`No gateway found for server ${input.serverId}`);
  const id = newId();

  await ctx.db.insert(missions).values({
    id,
    tenantId: ctx.tenantId,
    gatewayId,
    sessionId: input.sessionId,
    title: input.title,
    description: input.description ?? null,
    status: 'active',
    metadata: input.metadata ?? null,
  });

  return id;
}

export async function listMissions(
  ctx: CoreCtx,
  filters: { serverId: string; sessionId?: string },
) {
  const gatewayId = await resolveGatewayId(filters.serverId);
  if (!gatewayId) return [];

  const conditions = [
    eq(missions.tenantId, ctx.tenantId),
    eq(missions.gatewayId, gatewayId),
    ...(filters.sessionId ? [eq(missions.sessionId, filters.sessionId)] : []),
  ];

  const rows = await ctx.db
    .select()
    .from(missions)
    .where(and(...conditions))
    .orderBy(desc(missions.createdAt))
    .limit(200);

  return rows.map((r) => reshape(r, filters.serverId));
}

export async function getMission(ctx: CoreCtx, id: string) {
  const rows = await ctx.db
    .select()
    .from(missions)
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));

  const row = rows[0];
  if (!row) return null;
  return reshape(row, await resolveServerId(row.gatewayId));
}

export async function updateMission(
  ctx: CoreCtx,
  id: string,
  data: Partial<
    Pick<typeof missions.$inferInsert, 'title' | 'description' | 'status' | 'metadata'>
  >,
) {
  await ctx.db
    .update(missions)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));
}

export async function deleteMission(ctx: CoreCtx, id: string) {
  await ctx.db
    .delete(missions)
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));
}
