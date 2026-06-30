/**
 * Background-job runtime (hub-global).
 *
 * A generic durable runner so features survive navigation: work lives in the
 * `bg_jobs` table and is advanced server-side by a cron tick (or an authed
 * on-demand advance while a page is open). Features register a handler per
 * `type`; `advance()` does ONE bounded unit of work and reports whether more
 * remains. This module is feature-agnostic — group chat is just the first
 * consumer.
 */

import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';

export type BgJob = typeof bgJobs.$inferSelect;

export type AdvanceResult = {
  /** True when the job is complete and should be marked done. */
  done: boolean;
  /** Opaque progress state persisted for the next advance. */
  cursor?: unknown;
  /** Non-fatal status note (ignored unless `done`+`failed`). */
  error?: string;
};

export type JobHandler = {
  type: string;
  /** Advance the job by one bounded step. Persist domain changes here. */
  advance: (job: BgJob) => Promise<AdvanceResult>;
};

const handlers = new Map<string, JobHandler>();

/** Register a handler for a job `type`. Idempotent (last wins). */
export function registerJobHandler(h: JobHandler): void {
  handlers.set(h.type, h);
}

const LEASE_MS = 60_000; // a claimed job is owned for this long before reclaim

export async function enqueueJob(input: {
  tenantId: string;
  userId?: string | null;
  type: string;
  refId?: string | null;
  cursor?: unknown;
}): Promise<string> {
  const db = getCoreDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(bgJobs).values({
    id,
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    type: input.type,
    refId: input.refId ?? null,
    status: 'queued',
    cursor: input.cursor !== undefined ? JSON.stringify(input.cursor) : null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Cancel any active (queued/running) jobs for a domain entity. */
export async function cancelJobsByRef(refId: string): Promise<void> {
  await getCoreDb()
    .update(bgJobs)
    .set({ status: 'cancelled', finishedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(bgJobs.refId, refId), inArray(bgJobs.status, ['queued', 'running'])));
}

/** Mark a job as our lease (claim). Returns false if it was claimed elsewhere. */
async function claim(job: BgJob): Promise<boolean> {
  const db = getCoreDb();
  const now = Date.now();
  const res = await db
    .update(bgJobs)
    .set({ status: 'running', leaseUntil: now + LEASE_MS, startedAt: job.startedAt ?? now, updatedAt: now })
    // Re-check the claim precondition to avoid two ticks grabbing the same row.
    .where(
      and(
        eq(bgJobs.id, job.id),
        or(eq(bgJobs.status, 'queued'), and(eq(bgJobs.status, 'running'), lt(bgJobs.leaseUntil, now))),
      ),
    )
    .returning({ id: bgJobs.id });
  return res.length > 0;
}

async function finish(jobId: string, status: 'done' | 'failed' | 'cancelled', error?: string) {
  const now = Date.now();
  await getCoreDb()
    .update(bgJobs)
    .set({ status, error: error ?? null, finishedAt: now, updatedAt: now, leaseUntil: null })
    .where(eq(bgJobs.id, jobId));
}

async function persistProgress(jobId: string, cursor: unknown) {
  const now = Date.now();
  await getCoreDb()
    .update(bgJobs)
    .set({ cursor: cursor !== undefined ? JSON.stringify(cursor) : null, leaseUntil: now + LEASE_MS, updatedAt: now })
    .where(eq(bgJobs.id, jobId));
}

async function freshJob(jobId: string): Promise<BgJob | null> {
  const [row] = await getCoreDb().select().from(bgJobs).where(eq(bgJobs.id, jobId)).limit(1);
  return row ?? null;
}

/**
 * Advance a single job until it completes, is cancelled, or the time budget is
 * spent. Each handler.advance() is one model call / one bounded step.
 */
export async function advanceJob(jobId: string, budgetMs = 25_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let job = await freshJob(jobId);
  if (!job) return;
  const handler = handlers.get(job.type);
  if (!handler) return;
  if (job.status !== 'queued' && job.status !== 'running') return;
  if (!(await claim(job))) return;

  while (Date.now() < deadline) {
    job = await freshJob(jobId);
    if (!job || job.status === 'cancelled') return;
    let result: AdvanceResult;
    try {
      result = await handler.advance(job);
    } catch (err) {
      await finish(jobId, 'failed', err instanceof Error ? err.message : String(err));
      return;
    }
    if (result.done) {
      await finish(jobId, result.error ? 'failed' : 'done', result.error);
      return;
    }
    await persistProgress(jobId, result.cursor);
  }
  // Budget spent mid-flight: leave it 'running' with a lease so the next tick
  // (or an on-demand advance) reclaims and continues it.
}

/** Cron entrypoint: advance every resumable job within an overall budget. */
export async function runTick(budgetMs = 50_000): Promise<{ advanced: number }> {
  const db = getCoreDb();
  const now = Date.now();
  const resumable = await db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(or(eq(bgJobs.status, 'queued'), and(eq(bgJobs.status, 'running'), lt(bgJobs.leaseUntil, now))))
    .orderBy(asc(bgJobs.updatedAt))
    .limit(20);
  const deadline = Date.now() + budgetMs;
  let advanced = 0;
  for (const { id } of resumable) {
    if (Date.now() >= deadline) break;
    const remaining = deadline - Date.now();
    await advanceJob(id, Math.min(remaining, 25_000));
    advanced += 1;
  }
  return { advanced };
}
