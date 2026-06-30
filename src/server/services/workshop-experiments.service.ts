/**
 * Workshop experiments service — model comparison runs, rankings, leaderboard.
 *
 * Feature tables in Supabase PG (see src/server/db/pg-schema/workshop-experiments.ts).
 * All reads and writes are tenant-scoped via the TenantContext.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import {
  workshopComparisonOutputs,
  workshopComparisonRuns,
  workshopPromptCategories,
  workshopRankings,
} from '$server/db/pg-schema/workshop-experiments';

type Ctx = { tenantId: string };

export type CompareOutputInput = {
  modelId: string;
  provider?: string;
  status: 'pending' | 'done' | 'error';
  text?: string;
  error?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export async function saveComparisonRun(
  ctx: Ctx,
  userId: string | null,
  serverId: string | null,
  payload: {
    prompt: string;
    system?: string;
    params?: unknown;
    blind: boolean;
    outputs: CompareOutputInput[];
  },
): Promise<string> {
  const db = getCoreDb();
  const runId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(workshopComparisonRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    serverId,
    userId,
    prompt: payload.prompt,
    system: payload.system ?? null,
    params: payload.params ? JSON.stringify(payload.params) : null,
    modelIds: JSON.stringify(
      payload.outputs.map((o) => ({ provider: o.provider, modelId: o.modelId })),
    ),
    blind: payload.blind,
    categoryIds: null,
    createdAt: now,
    finishedAt: now,
  });
  if (payload.outputs.length > 0) {
    await db.insert(workshopComparisonOutputs).values(
      payload.outputs.map((o) => ({
        id: crypto.randomUUID(),
        runId,
        modelId: o.modelId,
        provider: o.provider ?? null,
        output: o.text ?? null,
        latencyMs: o.latencyMs ?? null,
        inputTokens: o.inputTokens ?? null,
        outputTokens: o.outputTokens ?? null,
        costUsd: o.costUsd ?? null,
        error: o.error ?? null,
        createdAt: now,
      })),
    );
  }
  return runId;
}

/** Resolve (creating as needed) category ids for a tenant from free-text names. */
async function ensureCategories(
  ctx: Ctx,
  names: string[],
): Promise<string[]> {
  const db = getCoreDb();
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (clean.length === 0) return [];
  const existing = await db
    .select()
    .from(workshopPromptCategories)
    .where(
      and(
        eq(workshopPromptCategories.tenantId, ctx.tenantId),
        inArray(workshopPromptCategories.name, clean),
      ),
    );
  const byName = new Map(existing.map((c) => [c.name, c.id]));
  const now = Date.now();
  const toCreate = clean.filter((n) => !byName.has(n));
  if (toCreate.length > 0) {
    const rows = toCreate.map((name) => ({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      name,
      source: 'user',
      createdAt: now,
    }));
    await db.insert(workshopPromptCategories).values(rows);
    for (const r of rows) byName.set(r.name, r.id);
  }
  return clean.map((n) => byName.get(n)!).filter(Boolean);
}

export async function saveRanking(
  ctx: Ctx,
  userId: string | null,
  runId: string,
  rankedModelIds: string[],
  categories: string[],
): Promise<void> {
  const db = getCoreDb();
  // Guard: the run must belong to this tenant.
  const run = await db
    .select({ id: workshopComparisonRuns.id })
    .from(workshopComparisonRuns)
    .where(
      and(eq(workshopComparisonRuns.id, runId), eq(workshopComparisonRuns.tenantId, ctx.tenantId)),
    )
    .limit(1);
  if (run.length === 0) throw new Error('run not found');

  const categoryIds = await ensureCategories(ctx, categories);
  if (categoryIds.length > 0) {
    await db
      .update(workshopComparisonRuns)
      .set({ categoryIds: JSON.stringify(categoryIds) })
      .where(eq(workshopComparisonRuns.id, runId));
  }

  // Replace any prior ranking for this run.
  await db.delete(workshopRankings).where(eq(workshopRankings.runId, runId));
  const now = Date.now();
  if (rankedModelIds.length > 0) {
    await db.insert(workshopRankings).values(
      rankedModelIds.map((modelId, i) => ({
        id: crypto.randomUUID(),
        runId,
        modelId,
        rank: i + 1,
        picked: i === 0,
        userId,
        createdAt: now,
      })),
    );
  }
}

export type LeaderboardRow = {
  modelId: string;
  rankings: number;
  wins: number;
  winRate: number;
  avgRank: number | null;
  runs: number;
  avgLatencyMs: number | null;
  totalCostUsd: number;
};

export async function getLeaderboard(ctx: Ctx): Promise<LeaderboardRow[]> {
  const db = getCoreDb();
  // Tenant's run ids.
  const runs = await db
    .select({ id: workshopComparisonRuns.id })
    .from(workshopComparisonRuns)
    .where(eq(workshopComparisonRuns.tenantId, ctx.tenantId));
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) return [];

  const rankings = await db
    .select()
    .from(workshopRankings)
    .where(inArray(workshopRankings.runId, runIds));
  const outputs = await db
    .select()
    .from(workshopComparisonOutputs)
    .where(inArray(workshopComparisonOutputs.runId, runIds));

  const agg = new Map<string, LeaderboardRow & { _rankSum: number; _latSum: number; _latN: number }>();
  const get = (modelId: string) => {
    let r = agg.get(modelId);
    if (!r) {
      r = {
        modelId,
        rankings: 0,
        wins: 0,
        winRate: 0,
        avgRank: null,
        runs: 0,
        avgLatencyMs: null,
        totalCostUsd: 0,
        _rankSum: 0,
        _latSum: 0,
        _latN: 0,
      };
      agg.set(modelId, r);
    }
    return r;
  };

  for (const rk of rankings) {
    const r = get(rk.modelId);
    r.rankings += 1;
    r._rankSum += rk.rank;
    if (rk.picked) r.wins += 1;
  }
  for (const o of outputs) {
    const r = get(o.modelId);
    r.runs += 1;
    if (typeof o.latencyMs === 'number') {
      r._latSum += o.latencyMs;
      r._latN += 1;
    }
    if (typeof o.costUsd === 'number') r.totalCostUsd += o.costUsd;
  }

  return [...agg.values()]
    .map((r) => ({
      modelId: r.modelId,
      rankings: r.rankings,
      wins: r.wins,
      winRate: r.rankings > 0 ? r.wins / r.rankings : 0,
      avgRank: r.rankings > 0 ? r._rankSum / r.rankings : null,
      runs: r.runs,
      avgLatencyMs: r._latN > 0 ? Math.round(r._latSum / r._latN) : null,
      totalCostUsd: r.totalCostUsd,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.runs - a.runs);
}
