import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { skillExecutionStats } from '@minion-stack/db/pg';
import { cached, keys, tags } from '@minion-stack/cache';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId, resolveServerId } from '$server/services/gateway.pg.service';
import { scopeData } from './base';

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

// pg keys on gateway_id, id is bigserial, occurredAt/createdAt are Date. The
// public shape stays Turso-era (serverId echoed, epoch-number occurredAt) so the
// reliability charts (which do time math on occurredAt) are unaffected.
type SkillStatRow = typeof skillExecutionStats.$inferSelect;

async function reshape(row: SkillStatRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId: await resolveServerId(row.gatewayId),
    agentId: row.agentId,
    skillName: row.skillName,
    sessionKey: row.sessionKey,
    status: row.status,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
    occurredAt: row.occurredAt.getTime(),
    createdAt: row.createdAt.getTime(),
  };
}

export async function insertSkillStats(ctx: CoreCtx, stats: SkillStatInput[]) {
  if (stats.length === 0) return;
  // Resolve each distinct serverId → gateway_id once.
  const gatewayByServer = new Map<string, string | null>();
  const rows: (typeof skillExecutionStats.$inferInsert)[] = [];
  for (const s of stats) {
    if (!gatewayByServer.has(s.serverId)) {
      gatewayByServer.set(s.serverId, await resolveGatewayId(s.serverId));
    }
    const gatewayId = gatewayByServer.get(s.serverId);
    if (!gatewayId) continue; // skip stats for an unbridged server
    rows.push({
      tenantId: ctx.tenantId,
      gatewayId,
      agentId: s.agentId ?? null,
      skillName: s.skillName,
      sessionKey: s.sessionKey ?? null,
      status: s.status,
      durationMs: s.durationMs ?? null,
      errorMessage: s.errorMessage ?? null,
      occurredAt: new Date(s.occurredAt),
    });
  }
  if (rows.length === 0) return;
  await ctx.db.insert(skillExecutionStats).values(rows);
}

export async function listSkillStats(
  ctx: CoreCtx,
  filters: {
    serverId?: string;
    skillName?: string;
    from?: number;
    to?: number;
    limit?: number;
  } = {},
) {
  const gatewayId = filters.serverId ? await resolveGatewayId(filters.serverId) : null;
  // A serverId that bridges no gateway → no rows.
  if (filters.serverId && !gatewayId) return [];

  return cached(
    keys.hub('skill-stats', {
      t: ctx.tenantId,
      d: scopeData({
        s: filters.serverId,
        sk: filters.skillName,
        f: filters.from,
        to: filters.to,
        l: filters.limit,
      }),
    }),
    {
      ttl: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'reliability'),
    },
    async () => {
      const conditions = [eq(skillExecutionStats.tenantId, ctx.tenantId)];

      if (gatewayId) conditions.push(eq(skillExecutionStats.gatewayId, gatewayId));
      if (filters.skillName) conditions.push(eq(skillExecutionStats.skillName, filters.skillName));
      if (filters.from)
        conditions.push(gte(skillExecutionStats.occurredAt, new Date(filters.from)));
      if (filters.to) conditions.push(lte(skillExecutionStats.occurredAt, new Date(filters.to)));

      const rows = await ctx.db
        .select()
        .from(skillExecutionStats)
        .where(and(...conditions))
        .orderBy(desc(skillExecutionStats.occurredAt))
        .limit(filters.limit ?? 200);
      return Promise.all(rows.map(reshape));
    },
  );
}

export async function getSkillStatsSummary(
  ctx: CoreCtx,
  filters: {
    serverId?: string;
    from?: number;
    to?: number;
  } = {},
) {
  const gatewayId = filters.serverId ? await resolveGatewayId(filters.serverId) : null;
  if (filters.serverId && !gatewayId) return { bySkill: [] };

  return cached(
    keys.hub('skill-stats-summary', {
      t: ctx.tenantId,
      d: scopeData({ s: filters.serverId, f: filters.from, to: filters.to }),
    }),
    {
      ttl: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'reliability'),
    },
    async () => {
      const conditions = [eq(skillExecutionStats.tenantId, ctx.tenantId)];

      if (gatewayId) conditions.push(eq(skillExecutionStats.gatewayId, gatewayId));
      if (filters.from)
        conditions.push(gte(skillExecutionStats.occurredAt, new Date(filters.from)));
      if (filters.to) conditions.push(lte(skillExecutionStats.occurredAt, new Date(filters.to)));

      const where = and(...conditions);

      const bySkill = await ctx.db
        .select({
          skillName: skillExecutionStats.skillName,
          status: skillExecutionStats.status,
          count: sql<number>`count(*)`.as('count'),
          avgDurationMs: sql<number>`avg(${skillExecutionStats.durationMs})`.as('avg_duration'),
          minDurationMs: sql<number>`min(${skillExecutionStats.durationMs})`.as('min_duration'),
          maxDurationMs: sql<number>`max(${skillExecutionStats.durationMs})`.as('max_duration'),
        })
        .from(skillExecutionStats)
        .where(where)
        .groupBy(skillExecutionStats.skillName, skillExecutionStats.status)
        .orderBy(sql`count(*) desc`);

      return { bySkill };
    },
  );
}
