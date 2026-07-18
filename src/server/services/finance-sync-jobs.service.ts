import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finSources, finSyncJobs, type FinSyncJob } from '$server/db/pg-finance-schema';

export const STALE_MS = 5 * 60_000; // 5min — wide enough that a slow page (per-page heartbeat) is never mistaken for a dead worker; cron still resumes truly-dead jobs
const ACTIVE = ['queued', 'running'];
const staleClause = sql`now() - interval '5 minutes'`;

export function getActiveJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider), inArray(finSyncJobs.status, ACTIVE)))
      .orderBy(desc(finSyncJobs.createdAt)).limit(1);
    return row ?? null;
  });
}

export function getLatestJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider)))
      .orderBy(desc(finSyncJobs.createdAt)).limit(1);
    return row ?? null;
  });
}

export function getJobById(ctx: CoreCtx, jobId: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))).limit(1);
    return row ?? null;
  });
}

export async function enqueueJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob> {
  const active = await getActiveJob(ctx, provider);
  if (active) return active;
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [row] = await tx.insert(finSyncJobs)
        .values({ orgId: ctx.tenantId, provider, status: 'queued', processed: 0 })
        .returning();
      return row;
    });
  } catch (e) {
    // Lost a race against the partial-unique active-job index → an active job now exists; return it.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      const existing = await getActiveJob(ctx, provider);
      if (existing) return existing;
    }
    throw e;
  }
}

/** Flip queued→running, or re-claim a running job whose heartbeat is stale. */
export async function claimJob(ctx: CoreCtx, jobId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.update(finSyncJobs)
      .set({ status: 'running', startedAt: sql`coalesce(${finSyncJobs.startedAt}, now())`, heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        eq(finSyncJobs.id, jobId),
        eq(finSyncJobs.orgId, ctx.tenantId),
        or(eq(finSyncJobs.status, 'queued'), and(eq(finSyncJobs.status, 'running'), lt(finSyncJobs.heartbeatAt, staleClause))),
      ))
      .returning({ id: finSyncJobs.id });
    return rows.length > 0;
  });
}

export async function heartbeat(
  ctx: CoreCtx, jobId: string, patch: { processed: number; total?: number | null; pageCursor: string | null },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs)
      .set({
        processed: patch.processed,
        ...(patch.total != null ? { total: patch.total } : {}),
        pageCursor: patch.pageCursor,
        heartbeatAt: sql`now()`, updatedAt: sql`now()`,
      })
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))),
  );
}

export async function isCancelRequested(ctx: CoreCtx, jobId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select({ cancelRequested: finSyncJobs.cancelRequested }).from(finSyncJobs)
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))).limit(1);
    return row?.cancelRequested === true;
  });
}

export async function requestCancel(ctx: CoreCtx, provider: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs).set({ cancelRequested: true, updatedAt: sql`now()` })
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider), inArray(finSyncJobs.status, ACTIVE))),
  );
}

export async function finishJob(
  ctx: CoreCtx, jobId: string, status: 'succeeded' | 'failed' | 'cancelled', opts: { error?: string } = {},
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs)
      .set({ status, error: opts.error ?? null, finishedAt: sql`now()`, heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))),
  );
}

/**
 * Cross-org discovery for the cron tick: queued jobs + running jobs with a
 * stale heartbeat, across ALL orgs. Runs on the bare `postgres` (bypass-RLS)
 * connection BY DESIGN — it is not request-scoped to one tenant. The caller
 * then builds a per-org CoreCtx and does all real work through withOrgCore.
 */
export async function findResumableJobs(limit = 3): Promise<Array<{ jobId: string; orgId: string; provider: string }>> {
  const db = getCoreDb();
  const rows = await db.select({ jobId: finSyncJobs.id, orgId: finSyncJobs.orgId, provider: finSyncJobs.provider })
    .from(finSyncJobs)
    .where(or(eq(finSyncJobs.status, 'queued'), and(eq(finSyncJobs.status, 'running'), lt(finSyncJobs.heartbeatAt, staleClause))))
    .orderBy(finSyncJobs.createdAt).limit(limit);
  return rows;
}

/**
 * Cross-org list of enabled sources for a provider — the daily-cron entrypoint.
 * Bypass-RLS by design (not request-scoped); the caller builds a per-org CoreCtx.
 */
export async function listEnabledSources(provider: string): Promise<Array<{ orgId: string; provider: string }>> {
  const db = getCoreDb();
  return db.select({ orgId: finSources.orgId, provider: finSources.provider })
    .from(finSources)
    .where(and(eq(finSources.provider, provider), eq(finSources.enabled, true)));
}
