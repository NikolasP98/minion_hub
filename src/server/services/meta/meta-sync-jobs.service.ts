import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { metaSyncJobs, type MetaSyncJob } from '$server/db/pg-meta-schema';

/**
 * Meta sync job lifecycle — clone of finance-sync-jobs.service.ts, adapted to
 * meta_sync_jobs' narrower shape, with generation-owned short leases.
 *
 * Jobs run in short bounded slices (meta-sync.service.ts): a slice claims the
 * job, does bounded work, then either finishes it or flips it back to 'queued'
 * with an updated page_cursor so the next tick resumes it. So 'running' only
 * ever spans one in-flight slice — it never idles between ticks waiting on a
 * heartbeat.
 *
 * Every mutation after claim carries the immutable owner + generation and
 * checks database time. A worker whose lease expires cannot revive itself or
 * publish progress after another worker takes over.
 */
export const META_SYNC_LEASE_SECONDS = 90;

export type MetaJobLease = Readonly<{
  jobId: string;
  orgId: string;
  ownerId: string;
  generation: number;
}>;

export function leaseFor(job: MetaSyncJob): MetaJobLease {
  if (!job.leaseOwner || job.status !== 'running') {
    throw new Error('Meta sync job is not claimed');
  }
  return {
    jobId: job.id,
    orgId: job.orgId,
    ownerId: job.leaseOwner,
    generation: job.leaseGeneration,
  };
}

export function getActiveJob(ctx: CoreCtx, kind: string): Promise<MetaSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(metaSyncJobs)
      .where(
        and(
          eq(metaSyncJobs.orgId, ctx.tenantId),
          eq(metaSyncJobs.kind, kind),
          or(eq(metaSyncJobs.status, 'queued'), eq(metaSyncJobs.status, 'running')),
        ),
      )
      .orderBy(desc(metaSyncJobs.createdAt))
      .limit(1);
    return row ?? null;
  });
}

/** Newest successful run of `kind` — used by the tick's enqueue-if-stale check. */
export function getLatestSucceededJob(ctx: CoreCtx, kind: string): Promise<MetaSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(metaSyncJobs)
      .where(
        and(
          eq(metaSyncJobs.orgId, ctx.tenantId),
          eq(metaSyncJobs.kind, kind),
          eq(metaSyncJobs.status, 'succeeded'),
        ),
      )
      .orderBy(desc(metaSyncJobs.createdAt))
      .limit(1);
    return row ?? null;
  });
}

export function getJobById(ctx: CoreCtx, jobId: string): Promise<MetaSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(metaSyncJobs)
      .where(and(eq(metaSyncJobs.id, jobId), eq(metaSyncJobs.orgId, ctx.tenantId)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Postgres error code, walking the `cause` chain — drizzle wraps driver errors
 * in DrizzleQueryError, so the code lives on `e.cause`, not `e` (live-verified:
 * a 23505 duplicate-active-job insert 500'd the run route because the bare
 * `e.code` check missed the wrapped code).
 */
export function pgErrorCode(e: unknown): string | undefined {
  for (let cur = e; cur && typeof cur === 'object'; cur = (cur as { cause?: unknown }).cause) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Idempotent enqueue vs the partial active-job unique index
 * `(org_id, kind) where status in ('queued','running')`. Same insert-then-
 * catch-23505 idiom as finance-sync-jobs.service.ts (and meta-connections
 * .service.ts's enqueueInitialSyncJobs) — Postgres can't ON CONFLICT-infer
 * against a partial index without repeating its WHERE, so this is the
 * practical equivalent of ON CONFLICT DO NOTHING.
 */
export async function enqueueJob(
  ctx: CoreCtx,
  kind: string,
  opts: { since?: string | null; until?: string | null } = {},
): Promise<MetaSyncJob> {
  try {
    return await withOrgCore(ctx, async (tx) => {
      const [row] = await tx
        .insert(metaSyncJobs)
        .values({
          orgId: ctx.tenantId,
          kind,
          status: 'queued',
          since: opts.since ?? null,
          until: opts.until ?? null,
        })
        .returning();
      return row;
    });
  } catch (e) {
    if (pgErrorCode(e) === '23505') {
      const existing = await getActiveJob(ctx, kind);
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Cross-org discovery for the tick: queued jobs + running jobs stuck past
 * STALE_MS, across ALL orgs. Runs on the bare bypass-RLS connection BY DESIGN
 * (mirrors finance's findResumableJobs) — the caller builds a per-org CoreCtx
 * and does all real work through withOrgCore.
 *
 * The two lanes are drawn under SEPARATE budgets rather than one shared limit,
 * because they cost wildly different amounts and starve each other in opposite
 * directions. A tail slice is one Graph page per target; a backlog slice
 * paginates up to 150 posts / 100 conversations / 90 ad rows with a 55s
 * per-request timeout. One shared limit either lets the tail lane (re-enqueued
 * for every org on every tick) freeze posts/ads/messages forever, or lets the
 * backlog lane blow up the tick's wall clock when it is scaled for tail
 * coverage. Sizing them independently is what keeps both bounded.
 */
export async function findDueJobs(
  tailLimit = 3,
  backlogLimit = 3,
): Promise<Array<{ jobId: string; orgId: string; kind: string }>> {
  const db = getCoreDb();
  const due = or(
    eq(metaSyncJobs.status, 'queued'),
    and(
      eq(metaSyncJobs.status, 'running'),
      sql`${metaSyncJobs.leaseExpiresAt} <= clock_timestamp()`,
    ),
  );
  const lane = (tail: boolean, limit: number) =>
    db
      .select({ jobId: metaSyncJobs.id, orgId: metaSyncJobs.orgId, kind: metaSyncJobs.kind })
      .from(metaSyncJobs)
      .where(
        and(
          due,
          tail ? eq(metaSyncJobs.kind, 'messages_tail') : ne(metaSyncJobs.kind, 'messages_tail'),
        ),
      )
      .orderBy(
        sql`case when ${metaSyncJobs.kind} = 'messages' then 0 else 1 end`,
        metaSyncJobs.createdAt,
      )
      .limit(Math.max(0, Math.trunc(limit)));
  const [tail, backlog] = await Promise.all([lane(true, tailLimit), lane(false, backlogLimit)]);
  return [...tail, ...backlog];
}

/** Keep the high-frequency freshness lane bounded without touching active
 * work or the recent audit window. Runs on the bypass-RLS scheduler
 * connection for the same cross-org reason as findDueJobs. */
export async function pruneTerminalTailJobs(olderThanDays = 7, limit = 2000): Promise<number> {
  const days = Math.min(365, Math.max(1, Math.trunc(olderThanDays)));
  const rowLimit = Math.min(10_000, Math.max(1, Math.trunc(limit)));
  const db = getCoreDb();
  const deleted = (await db.execute(sql`
    with doomed as (
      select id
      from meta_sync_jobs
      where kind = 'messages_tail'
        and status in ('succeeded', 'failed')
        and finished_at < now() - (${days} * interval '1 day')
      order by finished_at
      limit ${rowLimit}
    )
    delete from meta_sync_jobs job
    using doomed
    where job.id = doomed.id
    returning job.id
  `)) as unknown as Array<{ id: string }>;
  return deleted.length;
}

/** Atomically claim queued work or steal an expired generation. */
export async function claimJob(
  ctx: CoreCtx,
  jobId: string,
  ownerId: string,
): Promise<MetaSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .update(metaSyncJobs)
      .set({
        status: 'running',
        leaseOwner: ownerId,
        leaseGeneration: sql`${metaSyncJobs.leaseGeneration} + 1`,
        leaseExpiresAt: sql`clock_timestamp() + make_interval(secs => ${META_SYNC_LEASE_SECONDS})`,
        startedAt: sql`coalesce(${metaSyncJobs.startedAt}, clock_timestamp())`,
        finishedAt: null,
      })
      .where(
        and(
          eq(metaSyncJobs.id, jobId),
          eq(metaSyncJobs.orgId, ctx.tenantId),
          or(
            eq(metaSyncJobs.status, 'queued'),
            and(
              eq(metaSyncJobs.status, 'running'),
              sql`${metaSyncJobs.leaseExpiresAt} <= clock_timestamp()`,
            ),
          ),
        ),
      )
      .returning();
    return row ?? null;
  });
}

type Counts = Record<string, number | string[]>;

/** Pure: sum numeric counters key-wise; string[] values (diagnostics like
 *  skipErrors) concat capped at 3. Exported for unit tests. */
export function mergeCounts(base: Counts, delta: Counts): Counts {
  const out: Counts = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    const prev = out[k];
    out[k] = Array.isArray(v)
      ? [...(Array.isArray(prev) ? prev : []), ...v].slice(0, 3)
      : (typeof prev === 'number' ? prev : 0) + v;
  }
  return out;
}

export type MetaJobSettlement = Readonly<{
  status: 'queued' | 'succeeded' | 'failed';
  pageCursor?: string | null;
  countsDelta?: Counts;
  error?: string | null;
}>;

/** Cursor, counts, and next state commit together under the live generation. */
export async function settleJob(
  ctx: CoreCtx,
  lease: MetaJobLease,
  settlement: MetaJobSettlement,
): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const [current] = await tx
      .select({ counts: metaSyncJobs.counts })
      .from(metaSyncJobs)
      .where(
        and(
          eq(metaSyncJobs.id, lease.jobId),
          eq(metaSyncJobs.orgId, lease.orgId),
          eq(metaSyncJobs.status, 'running'),
          eq(metaSyncJobs.leaseOwner, lease.ownerId),
          eq(metaSyncJobs.leaseGeneration, lease.generation),
          sql`${metaSyncJobs.leaseExpiresAt} > clock_timestamp()`,
        ),
      )
      .for('update');
    if (!current) return false;

    const counts = settlement.countsDelta
      ? mergeCounts((current.counts as Counts) ?? {}, settlement.countsDelta)
      : undefined;
    const [updated] = await tx
      .update(metaSyncJobs)
      .set({
        status: settlement.status,
        ...(settlement.pageCursor !== undefined ? { pageCursor: settlement.pageCursor } : {}),
        ...(counts ? { counts } : {}),
        error: settlement.error ?? null,
        finishedAt: settlement.status === 'queued' ? null : sql`clock_timestamp()`,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(metaSyncJobs.id, lease.jobId),
          eq(metaSyncJobs.orgId, lease.orgId),
          eq(metaSyncJobs.status, 'running'),
          eq(metaSyncJobs.leaseOwner, lease.ownerId),
          eq(metaSyncJobs.leaseGeneration, lease.generation),
          sql`${metaSyncJobs.leaseExpiresAt} > clock_timestamp()`,
        ),
      )
      .returning({ id: metaSyncJobs.id });
    return updated !== undefined;
  });
}

/** Cancellation invalidates the current generation before any late completion. */
export async function cancelJob(ctx: CoreCtx, jobId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(metaSyncJobs)
      .set({
        status: 'cancelled',
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseGeneration: sql`${metaSyncJobs.leaseGeneration} + 1`,
        finishedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaSyncJobs.id, jobId),
          eq(metaSyncJobs.orgId, ctx.tenantId),
          or(eq(metaSyncJobs.status, 'queued'), eq(metaSyncJobs.status, 'running')),
        ),
      )
      .returning({ id: metaSyncJobs.id });
    return rows.length === 1;
  });
}
