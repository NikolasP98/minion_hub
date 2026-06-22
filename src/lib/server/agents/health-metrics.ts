import { and, eq, gte, sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { flowRuns } from '$server/db/pg-schema/flows';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { AutonomousAgentVM } from '$lib/agents/autonomous';

export type HealthMetrics = {
  state: 'active' | 'attention' | 'disabled';
  lastRunAt: number | null;
  runs30d: number | null;
  successRate: number | null;
};

const MS_30D = 30 * 24 * 60 * 60 * 1000;

/**
 * Generic per-agent health. DB-flow agents derive from flow_runs; gateway-native
 * system agents fall back to their status.stats; otherwise all-null ("—").
 */
export async function getHealthMetrics(
  ctx: CoreCtx,
  agent: AutonomousAgentVM,
  now: number = Date.now(),
): Promise<HealthMetrics> {
  const state = agent.status.state;

  if (agent.dbFlowId) {
    const since = now - MS_30D;
    const dbFlowId = agent.dbFlowId;
    return withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, async (tx) => {
      const rows = await tx
        .select({
          total: sql<number>`count(*)::int`,
          ok: sql<number>`count(*) filter (where ${flowRuns.status} = 'completed')::int`,
          last: sql<number | null>`max(${flowRuns.startedAt})`,
        })
        .from(flowRuns)
        .where(
          and(
            eq(flowRuns.flowId, dbFlowId),
            eq(flowRuns.tenantId, ctx.tenantId),
            gte(flowRuns.startedAt, since),
          ),
        );
      const r = rows[0] ?? { total: 0, ok: 0, last: null };
      const total = Number(r.total ?? 0);
      return {
        state,
        lastRunAt: r.last != null ? Number(r.last) : null,
        runs30d: total,
        successRate: total > 0 ? Number(r.ok ?? 0) / total : null,
      };
    });
  }

  const pre = agent.status.health;
  if (pre) {
    return { state, lastRunAt: pre.lastRunAt, runs30d: pre.runs30d, successRate: pre.successRate };
  }

  const stats = agent.status.stats;
  if (stats) {
    const denom = stats.sent + stats.failed;
    return {
      state,
      lastRunAt: null,
      runs30d: stats.sent + stats.failed + stats.skipped,
      successRate: denom > 0 ? stats.sent / denom : null,
    };
  }

  return { state, lastRunAt: null, runs30d: null, successRate: null };
}
