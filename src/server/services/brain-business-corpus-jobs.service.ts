import { and, eq, inArray } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import {
  advanceJob,
  enqueueJob,
  registerJobHandler,
  type AdvanceResult,
  type BgJob,
  type JobExecution,
} from './bg-runtime';
import {
  backfillBusinessKnowledgeDomain,
  BUSINESS_KNOWLEDGE_DOMAINS,
  ensureBusinessKnowledgeSources,
  recordBusinessKnowledgeDomainError,
  type BusinessKnowledgeDomainKey,
  type BusinessPageProgress,
} from './brain-business-corpus.service';
import { classifyCorpusJobError, corpusJobFailure } from './brain-corpus.service';

export const BRAIN_BUSINESS_CORPUS_JOB_TYPE = 'brain_corpus_business';
const RECONCILE_REF = 'business:reconcile';
const RECONCILE_BATCH = 50;
/** A page whose observed records changed is re-prepared this many times before
 * it counts as an ordinary domain failure. */
const SUPERSEDED_RETRIES = 2;

interface BusinessReconcileCursor {
  domainIndex: number;
  domainCursor: string | null;
  processed: number;
  changedChunks: number;
  embeddedChunks: number;
  failedDomains: number;
  /** Re-preparations of the current page after its source superseded it. */
  attempts?: number;
}

function initialCursor(): BusinessReconcileCursor {
  return {
    domainIndex: 0,
    domainCursor: null,
    processed: 0,
    changedChunks: 0,
    embeddedChunks: 0,
    failedDomains: 0,
  };
}

function businessCompletion(failedDomains: number): AdvanceResult {
  if (failedDomains <= 0) return { done: true };
  return {
    done: true,
    error: `Business corpus reconciliation completed with ${failedDomains} failed domain${failedDomains === 1 ? '' : 's'}`,
  };
}

function parseCursor(job: BgJob): BusinessReconcileCursor {
  if (!job.cursor) return initialCursor();
  const value = JSON.parse(job.cursor) as Partial<BusinessReconcileCursor>;
  return {
    domainIndex: Math.max(0, Math.floor(Number(value.domainIndex) || 0)),
    domainCursor: typeof value.domainCursor === 'string' ? value.domainCursor : null,
    processed: Math.max(0, Number(value.processed) || 0),
    changedChunks: Math.max(0, Number(value.changedChunks) || 0),
    embeddedChunks: Math.max(0, Number(value.embeddedChunks) || 0),
    failedDomains: Math.max(0, Number(value.failedDomains) || 0),
    attempts: Math.max(0, Number(value.attempts) || 0),
  };
}

/** Ensure the cheap Master/domain source shells and one durable bounded job. */
export async function ensureBusinessReconcileJob(
  orgId: string,
): Promise<{ jobId: string; created: boolean }> {
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId };
  await ensureBusinessKnowledgeSources(ctx);
  const db = getCoreDb();
  const [active] = await db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(
      and(
        eq(bgJobs.tenantId, orgId),
        eq(bgJobs.type, BRAIN_BUSINESS_CORPUS_JOB_TYPE),
        eq(bgJobs.refId, RECONCILE_REF),
        inArray(bgJobs.status, ['queued', 'running']),
      ),
    )
    .limit(1);
  if (active) return { jobId: active.id, created: false };
  return {
    jobId: await enqueueJob({
      tenantId: orgId,
      type: BRAIN_BUSINESS_CORPUS_JOB_TYPE,
      refId: RECONCILE_REF,
      cursor: initialCursor(),
    }),
    created: true,
  };
}

export async function advanceBusinessCorpusJob(
  job: BgJob,
  execution: JobExecution,
): Promise<AdvanceResult> {
  const cursor = parseCursor(job);
  const domain = BUSINESS_KNOWLEDGE_DOMAINS[cursor.domainIndex];
  if (!domain) return { done: true };
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: job.tenantId };
  const progress = (page: BusinessPageProgress): BusinessReconcileCursor => ({
    domainIndex: page.hasMore ? cursor.domainIndex : cursor.domainIndex + 1,
    domainCursor: page.hasMore ? page.nextCursor : null,
    processed: cursor.processed + page.processed,
    changedChunks: cursor.changedChunks + page.changedChunks,
    embeddedChunks: cursor.embeddedChunks + page.embeddedChunks,
    failedDomains: cursor.failedDomains,
    attempts: 0,
  });
  const finish = (next: BusinessReconcileCursor): AdvanceResult =>
    next.domainIndex >= BUSINESS_KNOWLEDGE_DOMAINS.length
      ? businessCompletion(next.failedDomains)
      : { done: false, cursor: next };
  let page: Awaited<ReturnType<typeof backfillBusinessKnowledgeDomain>>;
  try {
    page = await backfillBusinessKnowledgeDomain(
      ctx,
      domain.key,
      { cursor: cursor.domainCursor, limit: RECONCILE_BATCH },
      {
        execution,
        cursor: cursor as unknown as Record<string, unknown>,
        progress: (result) => progress(result) as unknown as Record<string, unknown>,
      },
    );
  } catch (cause) {
    // Lost ownership, indeterminate provider outcomes and reservation contention
    // are separated BEFORE ordinary domain failure accounting: no failedDomains
    // increment, no source status write, no progress past uncommitted work.
    const kind = classifyCorpusJobError(cause);
    if (kind === 'fenced') throw corpusJobFailure(cause, 'brain_corpus_business');
    const attempts = cursor.attempts ?? 0;
    if (kind === 'busy' || (kind === 'superseded' && attempts < SUPERSEDED_RETRIES))
      return {
        done: false,
        cursor: { ...cursor, attempts: kind === 'superseded' ? attempts + 1 : attempts },
      };
    const next: BusinessReconcileCursor = {
      ...cursor,
      domainIndex: cursor.domainIndex + 1,
      domainCursor: null,
      failedDomains: cursor.failedDomains + 1,
      attempts: 0,
    };
    // The domain-local failure and the exact next cursor commit together under
    // ownership; a stale worker cannot record either.
    await recordBusinessKnowledgeDomainError(ctx, domain.key, cause, {
      execution,
      nextProgress: next as unknown as Record<string, unknown>,
    });
    return finish(next);
  }
  return finish(progress(page));
}

registerJobHandler({ type: BRAIN_BUSINESS_CORPUS_JOB_TYPE, advance: advanceBusinessCorpusJob });

export async function advanceBusinessCorpusJobNow(jobId: string, budgetMs = 10_000): Promise<void> {
  await advanceJob(jobId, budgetMs);
}

export function businessDomainAt(index: number): BusinessKnowledgeDomainKey | null {
  return BUSINESS_KNOWLEDGE_DOMAINS[index]?.key ?? null;
}
