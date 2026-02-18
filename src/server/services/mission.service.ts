import { eq, and, desc } from 'drizzle-orm';
import { missions } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface MissionInput {
  serverId: string;
  sessionId: string;
  title: string;
  description?: string;
  metadata?: string;
}

export async function createMission(ctx: TenantContext, input: MissionInput) {
  const now = nowMs();
  const id = newId();

  await ctx.db.insert(missions).values({
    id,
    tenantId: ctx.tenantId,
    serverId: input.serverId,
    sessionId: input.sessionId,
    title: input.title,
    description: input.description ?? null,
    status: 'active',
    metadata: input.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function listMissions(
  ctx: TenantContext,
  filters: { serverId: string; sessionId?: string },
) {
  if (filters.sessionId) {
    return ctx.db
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.tenantId, ctx.tenantId),
          eq(missions.serverId, filters.serverId),
          eq(missions.sessionId, filters.sessionId),
        ),
      )
      .orderBy(desc(missions.createdAt))
      .limit(200);
  }

  return ctx.db
    .select()
    .from(missions)
    .where(
      and(eq(missions.tenantId, ctx.tenantId), eq(missions.serverId, filters.serverId)),
    )
    .orderBy(desc(missions.createdAt))
    .limit(200);
}

export async function getMission(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(missions)
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));

  return rows[0] ?? null;
}

export async function updateMission(
  ctx: TenantContext,
  id: string,
  data: Partial<Pick<typeof missions.$inferInsert, 'title' | 'description' | 'status' | 'metadata'>>,
) {
  await ctx.db
    .update(missions)
    .set({ ...data, updatedAt: nowMs() })
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));
}

export async function deleteMission(ctx: TenantContext, id: string) {
  await ctx.db
    .delete(missions)
    .where(and(eq(missions.id, id), eq(missions.tenantId, ctx.tenantId)));
}
