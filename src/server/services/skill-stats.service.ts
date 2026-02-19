import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { skillExecutionStats } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface SkillStatInput {
  serverId: string;
  agentId?: string;
  skillName: string;
  sessionKey?: string;
  status: 'ok' | 'auth_error' | 'timeout' | 'error';
  durationMs?: number;
  errorMessage?: string;
  occurredAt: number;
}

export async function insertSkillStats(
  ctx: TenantContext,
  stats: SkillStatInput[],
) {
  if (stats.length === 0) return;
  const now = nowMs();
  await ctx.db.insert(skillExecutionStats).values(
    stats.map((s) => ({
      tenantId: ctx.tenantId,
      serverId: s.serverId,
      agentId: s.agentId ?? null,
      skillName: s.skillName,
      sessionKey: s.sessionKey ?? null,
      status: s.status,
      durationMs: s.durationMs ?? null,
      errorMessage: s.errorMessage ?? null,
      occurredAt: s.occurredAt,
      createdAt: now,
    })),
  );
}

export async function listSkillStats(
  ctx: TenantContext,
  filters: {
    serverId?: string;
    skillName?: string;
    from?: number;
    to?: number;
    limit?: number;
  } = {},
) {
  const conditions = [eq(skillExecutionStats.tenantId, ctx.tenantId)];

  if (filters.serverId)
    conditions.push(eq(skillExecutionStats.serverId, filters.serverId));
  if (filters.skillName)
    conditions.push(eq(skillExecutionStats.skillName, filters.skillName));
  if (filters.from)
    conditions.push(gte(skillExecutionStats.occurredAt, filters.from));
  if (filters.to)
    conditions.push(lte(skillExecutionStats.occurredAt, filters.to));

  return ctx.db
    .select()
    .from(skillExecutionStats)
    .where(and(...conditions))
    .orderBy(desc(skillExecutionStats.occurredAt))
    .limit(filters.limit ?? 200);
}

export async function getSkillStatsSummary(
  ctx: TenantContext,
  filters: {
    serverId?: string;
    from?: number;
    to?: number;
  } = {},
) {
  const conditions = [eq(skillExecutionStats.tenantId, ctx.tenantId)];

  if (filters.serverId)
    conditions.push(eq(skillExecutionStats.serverId, filters.serverId));
  if (filters.from)
    conditions.push(gte(skillExecutionStats.occurredAt, filters.from));
  if (filters.to)
    conditions.push(lte(skillExecutionStats.occurredAt, filters.to));

  const where = and(...conditions);

  const bySkill = await ctx.db
    .select({
      skillName: skillExecutionStats.skillName,
      status: skillExecutionStats.status,
      count: sql<number>`count(*)`.as('count'),
      avgDurationMs: sql<number>`avg(${skillExecutionStats.durationMs})`.as('avg_duration'),
    })
    .from(skillExecutionStats)
    .where(where)
    .groupBy(skillExecutionStats.skillName, skillExecutionStats.status)
    .orderBy(sql`count(*) desc`);

  return { bySkill };
}
