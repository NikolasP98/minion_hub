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

import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';

export type BgJob = typeof bgJobs.$inferSelect;
export type JobTransaction = Parameters<
  Parameters<ReturnType<typeof getCoreDb>['transaction']>[0]
>[0];
export type JobExecution = {
  jobId: string;
  tenantId: string;
  leaseGeneration: number;
  signal: AbortSignal;
  /** Stable across lease generations. Entity scope also joins duplicate jobs. */
  effectKey: (logicalStep: string, entityId?: string) => string;
  /** Short database-only transaction. Never hold this across a provider call. */
  withOwnership: <T>(operation: (tx: JobTransaction, current: BgJob) => Promise<T>) => Promise<T>;
};

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
  advance: (job: BgJob, execution: JobExecution) => Promise<AdvanceResult>;
};

const handlers = new Map<string, JobHandler>();

/** Register a handler for a job `type`. Idempotent (last wins). */
export function registerJobHandler(h: JobHandler): void {
  handlers.set(h.type, h);
}

// TODO(handoff): Adopt JobExecution in statement_ingest, brain_ingest, brain_corpus_conversations/whatsapp and brain_corpus_business; their domain effects still need ownership gates. See meta proposals/2026-09-08-platform-qc-remediation.md (HDS-05).
const LEASE_MS = 60_000; // a claimed job is owned for this long before reclaim
const HEARTBEAT_MS = LEASE_MS / 3;
type Lease = Pick<BgJob, 'id' | 'tenantId' | 'leaseGeneration'>;

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
    .set({
      status: 'cancelled',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      leaseUntil: null,
      leaseGeneration: sql`${bgJobs.leaseGeneration} + 1`,
    })
    .where(and(eq(bgJobs.refId, refId), inArray(bgJobs.status, ['queued', 'running'])));
}

/** Claim atomically and return the committed ownership generation. */
async function claim(job: BgJob): Promise<Lease | null> {
  const now = Date.now();
  const [lease] = await getCoreDb()
    .update(bgJobs)
    .set({
      status: 'running',
      leaseUntil: now + LEASE_MS,
      leaseGeneration: sql`${bgJobs.leaseGeneration} + 1`,
      startedAt: sql`coalesce(${bgJobs.startedAt}, ${now})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(bgJobs.id, job.id),
        eq(bgJobs.tenantId, job.tenantId),
        or(
          eq(bgJobs.status, 'queued'),
          and(eq(bgJobs.status, 'running'), lte(bgJobs.leaseUntil, now)),
        ),
      ),
    )
    .returning({
      id: bgJobs.id,
      tenantId: bgJobs.tenantId,
      leaseGeneration: bgJobs.leaseGeneration,
    });
  return lease ?? null;
}

/** Expired ownership cannot be revived, even before a replacement claims it. */
function ownsLease(lease: Lease, now: number) {
  return and(
    eq(bgJobs.id, lease.id),
    eq(bgJobs.tenantId, lease.tenantId),
    eq(bgJobs.status, 'running'),
    eq(bgJobs.leaseGeneration, lease.leaseGeneration),
    gt(bgJobs.leaseUntil, now),
  );
}

async function finish(lease: Lease, status: 'done' | 'failed', error?: string) {
  const now = Date.now();
  await getCoreDb()
    .update(bgJobs)
    .set({ status, error: error ?? null, finishedAt: now, updatedAt: now, leaseUntil: null })
    .where(ownsLease(lease, now));
}

async function persistProgress(lease: Lease, cursor: unknown): Promise<boolean> {
  const now = Date.now();
  const rows = await getCoreDb()
    .update(bgJobs)
    .set({
      cursor: cursor !== undefined ? JSON.stringify(cursor) : null,
      leaseUntil: now + LEASE_MS,
      updatedAt: now,
    })
    .where(ownsLease(lease, now))
    .returning({ id: bgJobs.id });
  return rows.length === 1;
}

function heartbeat(lease: Lease) {
  let stopped = false;
  let pending = false;
  let lose!: () => void;
  const lost = new Promise<void>((resolve) => {
    lose = resolve;
  });
  const timer = setInterval(() => {
    if (stopped || pending) return;
    pending = true;
    const renew = async () => {
      try {
        const now = Date.now();
        const rows = await getCoreDb()
          .update(bgJobs)
          .set({ leaseUntil: now + LEASE_MS, updatedAt: now })
          .where(ownsLease(lease, now))
          .returning({ id: bgJobs.id });
        if (rows.length !== 1) lose();
      } catch {
        // Ownership cannot be established after a storage error: stop admission.
        lose();
      } finally {
        pending = false;
      }
    };
    void renew();
  }, HEARTBEAT_MS);
  timer.unref?.();
  return {
    lost,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
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
  const initial = await freshJob(jobId);
  if (!initial || Date.now() >= deadline) return;
  const handler = handlers.get(initial.type);
  if (!handler || (initial.status !== 'queued' && initial.status !== 'running')) return;
  const lease = await claim(initial);
  if (!lease) return;
  const pulse = heartbeat(lease);
  const abort = new AbortController();
  const execution: JobExecution = {
    jobId: lease.id,
    tenantId: lease.tenantId,
    leaseGeneration: lease.leaseGeneration,
    signal: abort.signal,
    effectKey: (step, entityId = lease.id) =>
      createHash('sha256')
        .update(JSON.stringify([lease.tenantId, initial.type, entityId, step]))
        .digest('hex'),
    withOwnership: async (operation) =>
      getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(bgJobs)
          .where(and(eq(bgJobs.id, lease.id), eq(bgJobs.tenantId, lease.tenantId)))
          .for('update');
        // Recheck after acquiring the lock: time spent waiting cannot extend authority.
        if (
          abort.signal.aborted ||
          !current ||
          current.status !== 'running' ||
          current.leaseGeneration !== lease.leaseGeneration ||
          (current.leaseUntil ?? 0) <= Date.now()
        ) {
          abort.abort();
          throw new Error('background job ownership lost');
        }
        const result = await operation(tx, current);
        if (abort.signal.aborted || (current.leaseUntil ?? 0) <= Date.now()) {
          abort.abort();
          throw new Error('background job ownership lost');
        }
        return result;
      }),
  };
  let lost = false;
  const leaseLost = Symbol('lease-lost');
  const loss: Promise<typeof leaseLost> = pulse.lost.then(() => {
    lost = true;
    abort.abort();
    return leaseLost;
  });
  try {
    while (!lost && Date.now() < deadline) {
      const job = await freshJob(jobId);
      if (
        lost ||
        !job ||
        job.status !== 'running' ||
        job.tenantId !== lease.tenantId ||
        job.leaseGeneration !== lease.leaseGeneration ||
        (job.leaseUntil ?? 0) <= Date.now()
      )
        return;
      let result: AdvanceResult;
      try {
        // Losing the lease ends our wait, not the external operation. Promise.race
        // retains a rejection handler for a callback that settles after cancellation.
        const outcome = await Promise.race([handler.advance(job, execution), loss]);
        if (outcome === leaseLost || lost) return;
        result = outcome;
      } catch (err) {
        if (!lost) await finish(lease, 'failed', err instanceof Error ? err.message : String(err));
        return;
      }
      if (result.done) {
        await finish(lease, result.error ? 'failed' : 'done', result.error);
        return;
      }
      if (!(await persistProgress(lease, result.cursor))) return;
    }
    // The budget bounds admission, not a callback already in flight. Leave the
    // final lease to expire so a future tick resumes the persisted cursor.
  } finally {
    pulse.stop();
    abort.abort();
  }
}

/** Cron entrypoint: advance every resumable job within an overall budget. */
export async function runTick(budgetMs = 50_000): Promise<{ advanced: number }> {
  const db = getCoreDb();
  const now = Date.now();
  const resumable = await db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(
      or(
        eq(bgJobs.status, 'queued'),
        and(eq(bgJobs.status, 'running'), lte(bgJobs.leaseUntil, now)),
      ),
    )
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
