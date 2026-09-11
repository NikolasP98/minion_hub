/**
 * Personal-finance statement imports (WP4, R4/R5 — specs/2026-07-22-personal-
 * org-differentiation-spec.md). Orchestrates: content-addressed dedupe, blob
 * storage (reuses file.service), a resumable `statement_ingest` bg-runtime
 * handler, and status/retry/undo.
 *
 * No LLM path in this wave — ambiguous rows are marked 'needs-llm' by the
 * deterministic parser (finance-statement-parser.ts) and simply counted as
 * rejected; the gateway drone fallback is R5/WP5 (later, cross-repo).
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  finStatementImports,
  finTransactions,
  type FinStatementImport,
} from '$server/db/pg-finance-schema';
import { uploadFile, getFileUrl } from './file.service';
import {
  registerJobHandler,
  advanceJob,
  type AdvanceResult,
  type BgJob,
  type JobExecution,
} from './bg-runtime';
import {
  createJobRequest,
  revokeJobRequest,
  readJobRequest,
  withJobRequest,
  jobRequestAdvanceResult,
  JobEffectError,
} from './job-effects.service';
import {
  parseStatementCsv,
  normalizeStatementText,
  type StatementParseResult,
  type StatementEntryOk,
} from './finance-statement-parser';
import { getTenant } from './tenant.service';

/**
 * The statement pipeline is personal-org-only (R5 — business orgs sync via the
 * SUSII connector instead). 404, not 403: business callers must not learn the
 * route exists. Same getTenant-by-tenantId pattern as the /pulse kind guard.
 * Shared by all four /api/finances/statement-imports endpoints.
 */
export async function requirePersonalOrg(ctx: CoreCtx): Promise<void> {
  const tenant = await getTenant({ tenantId: ctx.tenantId } as Parameters<typeof getTenant>[0]);
  if (tenant?.kind !== 'personal') throw error(404, 'Not found');
}

export const STATEMENT_JOB_TYPE = 'statement_ingest';
const PARSER_VERSION = 1;
// ponytail: bounded rows-per-advance() step, not a hard system limit — raise
// if real statements regularly need more than a couple of ticks to ingest.
const CHUNK_SIZE = 500;
// ponytail: rejections are recomputed by re-parsing on every status read
// (deterministic + cheap for statement-sized files) rather than persisted in
// a new table/column — cap what we return so a huge rejected set can't bloat
// the response.
const MAX_REJECTIONS_IN_STATUS = 200;

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes)
    .digest('hex');
}

async function findBySha(ctx: CoreCtx, sha: string): Promise<FinStatementImport | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(finStatementImports)
      .where(
        and(
          eq(finStatementImports.orgId, ctx.tenantId),
          eq(finStatementImports.contentSha256, sha),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Kick the already committed ingest job once so a persistent runtime (localhost
 *  / adapter-node) can make immediate progress; the cron tick resumes it if
 *  the process is frozen mid-flight (serverless). Mirrors finance-sync's POST. */
function kick(jobId: string): void {
  void advanceJob(jobId, Number.POSITIVE_INFINITY).catch((e) =>
    console.error('[finance-statements] advanceJob failed', e),
  );
}

const importEntity = (id: string) => ({ family: 'finance.statement', entityId: id });
const sourceIdentity = (row: Pick<FinStatementImport, 'contentSha256' | 'parserVersion'>) =>
  sha256Hex(JSON.stringify([row.contentSha256, row.parserVersion]));

async function lockedImport(tx: CoreTx, ctx: CoreCtx, id: string) {
  const [row] = await tx
    .select()
    .from(finStatementImports)
    .where(and(eq(finStatementImports.id, id), eq(finStatementImports.orgId, ctx.tenantId)))
    .for('update');
  return row ?? null;
}

class UnchangedImport extends Error {
  constructor(readonly row: FinStatementImport | null) {
    super('Import does not require a new request');
  }
}

export interface CreateImportInput {
  sourceKind: 'csv' | 'text';
  fileName?: string;
  contentType?: string;
  /** Raw uploaded bytes — required for sourceKind 'csv'. */
  bytes?: Uint8Array;
  /** Pasted text — required for sourceKind 'text'; CRLF-normalized before hashing/storing. */
  text?: string;
  createdBy?: string | null;
}

/**
 * Create (or return the existing) import for this content. Idempotency: the
 * sha-256 of the exact uploaded bytes (CRLF-normalized for pasted text) is
 * checked before storage writes, so serial duplicate submissions reuse the
 * stored file. Concurrent submissions can both upload; the unique constraint
 * returns one committed import/request while blob reconciliation is separate.
 */
export async function createImport(
  ctx: CoreCtx,
  input: CreateImportInput,
): Promise<{ import: FinStatementImport; created: boolean }> {
  const bytes =
    input.sourceKind === 'text'
      ? Buffer.from(normalizeStatementText(input.text ?? ''), 'utf8')
      : (input.bytes ?? new Uint8Array());
  const sha = sha256Hex(bytes);

  const existing = await findBySha(ctx, sha);
  if (existing) {
    // An earlier undo left this content 'undone' (transactions deleted,
    // cursor zeroed) — resubmitting the same content should resume ingest,
    // not silently return a stranded row that nothing ever re-enqueues.
    if (existing.status === 'undone') {
      const requeued = await retryImport(ctx, existing.id);
      if (!requeued) throw new JobEffectError('conflict', 'Import disappeared during resubmission');
      return { import: requeued, created: false };
    }
    return { import: existing, created: false };
  }

  // TODO(handoff): Reconcile uploaded blobs after failed/concurrent import creation;
  // content dedup cannot reclaim an upload that lost the SQL race. See meta
  // proposals/2026-09-08-platform-qc-remediation.md (finance blob orphans).
  const fileId = await uploadFile(ctx, {
    fileName:
      input.fileName ?? (input.sourceKind === 'text' ? 'pasted-statement.txt' : 'statement.csv'),
    contentType: input.contentType ?? (input.sourceKind === 'text' ? 'text/plain' : 'text/csv'),
    data: bytes,
    category: 'finance-statements',
    uploadedBy: input.createdBy ?? undefined,
  });

  let row: FinStatementImport;
  try {
    const id = randomUUID();
    const created = await createJobRequest(
      ctx,
      importEntity(id),
      sourceIdentity({ contentSha256: sha, parserVersion: PARSER_VERSION }),
      { type: STATEMENT_JOB_TYPE, userId: ctx.profileId, refId: id },
      async (tx) => {
        const [inserted] = await tx
          .insert(finStatementImports)
          .values({
            id,
            orgId: ctx.tenantId,
            fileId,
            sourceKind: input.sourceKind,
            contentSha256: sha,
            parserVersion: PARSER_VERSION,
            status: 'queued',
            nextChunk: 0,
            createdBy: input.createdBy ?? null,
          })
          .returning();
        return inserted;
      },
    );
    row = created.value;
    kick(created.jobId);
  } catch (e) {
    // Lost a race against UNIQUE(org_id, content_sha256) — another request
    // created it first; return that row instead of duplicating.
    const databaseError = e instanceof Error && e.cause ? e.cause : e;
    if (
      databaseError &&
      typeof databaseError === 'object' &&
      'code' in databaseError &&
      databaseError.code === '23505' &&
      'constraint_name' in databaseError &&
      databaseError.constraint_name === 'fin_statement_imports_org_sha_uniq'
    ) {
      const raced = await findBySha(ctx, sha);
      if (raced) {
        const restored = raced.status === 'undone' ? await retryImport(ctx, raced.id) : raced;
        if (restored) return { import: restored, created: false };
      }
    }
    throw e;
  }

  return { import: row, created: true };
}

async function loadImportText(
  ctx: CoreCtx,
  row: FinStatementImport,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!row.fileId) throw new Error('import has no stored content');
  const file = await getFileUrl(ctx, row.fileId);
  if (!file) throw new Error('stored statement content not found');
  signal?.throwIfAborted();
  const res = await fetch(file.url, { signal });
  if (!res.ok) throw new Error(`failed to fetch statement content (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  signal?.throwIfAborted();
  if (signal && sha256Hex(bytes) !== row.contentSha256)
    throw new Error('stored statement content hash mismatch');
  return new TextDecoder().decode(bytes);
}

/** One bounded step: parse (deterministic, re-run every call — cheap for
 *  statement-sized files) and persist the next CHUNK_SIZE rows starting at
 *  `next_chunk`. Insert uses onConflictDoNothing on (import_id, source_row),
 *  so re-running the same chunk (retry, or a resumed lease) never duplicates. */
export async function persistImportChunk(
  ctx: CoreCtx,
  job: BgJob,
  execution: JobExecution,
): Promise<AdvanceResult> {
  ctx = { ...ctx };
  job = { ...job };
  const checkCancelled = () => {
    if (execution.signal.aborted)
      throw new JobEffectError('ownership_lost', 'Statement job ownership was cancelled');
  };
  checkCancelled();
  if (
    !job.refId ||
    job.type !== STATEMENT_JOB_TYPE ||
    job.tenantId !== ctx.tenantId ||
    job.id !== execution.jobId
  )
    throw new JobEffectError('conflict', 'Statement job identity mismatch');
  const importId = job.refId;
  const request = readJobRequest(job);
  // Unversioned jobs cannot prove which reset admitted them. Explicit retry
  // establishes a new revision while preserving the stored rows and cursor.
  if (!request)
    throw new JobEffectError(
      'conflict',
      'Unversioned statement job: explicitly retry this import to establish ownership',
    );
  if (request.family !== importEntity(importId).family || request.entityId !== importId)
    throw new JobEffectError('conflict', 'Statement request identity mismatch');
  const readCurrent = async (tx: CoreTx) => {
    const row = await lockedImport(tx, ctx, importId);
    if (!row || row.status === 'undone')
      throw new JobEffectError('superseded', 'Statement import is missing or undone');
    if (row.parserVersion !== PARSER_VERSION || sourceIdentity(row) !== request.sourceHash)
      throw new JobEffectError('conflict', 'Statement content or parser identity changed');
    return row;
  };
  const initial = await withJobRequest(execution, ctx, request, readCurrent);
  if (initial.status === 'done' || initial.status === 'failed') {
    const result = await jobRequestAdvanceResult(execution, ctx, request, true);
    return initial.status === 'failed'
      ? { ...result, error: initial.errorMessage ?? 'import failed' }
      : result;
  }

  let parsed: StatementParseResult;
  try {
    const text = await loadImportText(ctx, initial, execution.signal);
    checkCancelled();
    parsed = parseStatementCsv(text);
    checkCancelled();
  } catch (e) {
    checkCancelled();
    const message = e instanceof Error ? e.message : String(e);
    await withJobRequest(
      execution,
      ctx,
      request,
      async (tx) => {
        const row = await readCurrent(tx);
        if (row.nextChunk !== initial.nextChunk || !['queued', 'parsing'].includes(row.status))
          throw new JobEffectError(
            'conflict',
            'Statement changed before parse failure could be recorded',
          );
        await tx
          .update(finStatementImports)
          .set({
            status: 'failed',
            errorCode: 'parse_failed',
            errorMessage: message,
            finishedAt: new Date(),
          })
          .where(eq(finStatementImports.id, importId));
      },
      { nextChunk: initial.nextChunk },
    );
    return { ...(await jobRequestAdvanceResult(execution, ctx, request, true)), error: message };
  }

  const outcome = await withJobRequest(
    execution,
    ctx,
    request,
    async (tx) => {
      checkCancelled();
      const row = await readCurrent(tx);
      if (row.status === 'failed')
        throw new JobEffectError('conflict', 'Statement was failed by another worker');
      if (row.status === 'done' || row.nextChunk !== initial.nextChunk)
        return { done: row.status === 'done', nextChunk: row.nextChunk };
      if (!['queued', 'parsing'].includes(row.status))
        throw new JobEffectError('conflict', 'Invalid statement import state');

      const total = parsed.entries.length;
      const slice = parsed.entries.slice(row.nextChunk, row.nextChunk + CHUNK_SIZE);
      const okSlice = slice.filter((e): e is StatementEntryOk => e.ok);

      // .returning() reports the rows the INSERT actually landed — a chunk
      // replay (retry, resumed lease) hits onConflictDoNothing for rows already
      // persisted, so this can be < okSlice.length. Counting the returned rows
      // (not the slice length) keeps insertedCount accurate under replay.
      let insertedRows = 0;
      if (okSlice.length > 0) {
        const inserted = await tx
          .insert(finTransactions)
          .values(
            okSlice.map((e) => ({
              orgId: ctx.tenantId,
              importId,
              sourceRow: e.sourceRow,
              postedOn: e.postedOn,
              description: e.description,
              signedAmount: e.signedAmount,
              currency: e.currency,
              counterparty: e.counterparty,
              category: e.category,
              reference: e.reference,
              confidence: e.confidence == null ? null : String(e.confidence), // numeric column — money-string convention
              warnings: e.warnings,
              raw: e.raw,
            })),
          )
          .onConflictDoNothing({ target: [finTransactions.importId, finTransactions.sourceRow] })
          .returning({ id: finTransactions.id });
        insertedRows = inserted.length;
      }

      const nextChunk = row.nextChunk + slice.length;
      const done = nextChunk >= total;
      // The domain row is locked after job/head ownership. A failed CAS rolls
      // back the inserts and counters; job progress shares this transaction.
      const changed = await tx
        .update(finStatementImports)
        .set({
          nextChunk,
          rowCount: total,
          insertedCount: (row.insertedCount ?? 0) + insertedRows,
          rejectedCount: (row.rejectedCount ?? 0) + (slice.length - okSlice.length),
          status: done ? 'done' : 'parsing',
          finishedAt: done ? new Date() : null,
        })
        .where(
          and(
            eq(finStatementImports.id, importId),
            eq(finStatementImports.nextChunk, row.nextChunk),
          ),
        )
        .returning({ id: finStatementImports.id });
      if (changed.length !== 1)
        throw new JobEffectError('conflict', 'Statement chunk cursor was not advanced');

      return { done, nextChunk };
    },
    (result) => ({ nextChunk: result.nextChunk }),
  );
  return jobRequestAdvanceResult(execution, ctx, request, outcome.done);
}

async function advanceStatementIngest(job: BgJob, execution: JobExecution): Promise<AdvanceResult> {
  if (!job.refId) return { done: true, error: 'missing refId' };
  const ctx: CoreCtx = {
    db: getCoreDb(),
    tenantId: job.tenantId,
    profileId: job.userId ?? undefined,
  };
  return persistImportChunk(ctx, job, execution);
}

registerJobHandler({ type: STATEMENT_JOB_TYPE, advance: advanceStatementIngest });

export interface ImportStatus {
  import: FinStatementImport;
  rejections: Array<{ sourceRow: number; reason: string; raw: Record<string, string> }>;
}

/** Status incl. counts + a bounded sample of rejections (recomputed by
 *  re-parsing the stored content — cheap, deterministic, no extra table). */
export async function getImportStatus(
  ctx: CoreCtx,
  importId: string,
): Promise<ImportStatus | null> {
  const row = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .select()
      .from(finStatementImports)
      .where(and(eq(finStatementImports.id, importId), eq(finStatementImports.orgId, ctx.tenantId)))
      .limit(1);
    return r ?? null;
  });
  if (!row) return null;

  // TODO(handoff): Expose job failure/recovery alongside import status. A SQL
  // rollback or unversioned job rejection can leave queued/parsing domain state;
  // explicit retry is available through the authenticated API, but status/UI
  // reconciliation is separate. See meta proposals/2026-09-08-platform-qc-remediation.md (finance job recovery).
  let rejections: ImportStatus['rejections'] = [];
  if (row.status === 'done' || row.status === 'parsing') {
    try {
      const text = await loadImportText(ctx, row);
      rejections = parseStatementCsv(text)
        .rejected.slice(0, MAX_REJECTIONS_IN_STATUS)
        .map((r) => ({ sourceRow: r.sourceRow, reason: r.reason, raw: r.raw }));
    } catch {
      // Best-effort — status/counts are already accurate; don't fail the read.
    }
  }
  return { import: row, rejections };
}

/** Explicit retry replaces queued/parsing/failed/undone requests, preserving
 * persisted rows, counts and next_chunk. This also recovers unversioned jobs.
 * A completed import stays unchanged. */
export async function retryImport(
  ctx: CoreCtx,
  importId: string,
): Promise<FinStatementImport | null> {
  const row = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .select()
      .from(finStatementImports)
      .where(and(eq(finStatementImports.id, importId), eq(finStatementImports.orgId, ctx.tenantId)))
      .limit(1);
    return r ?? null;
  });
  if (!row) return null;
  if (!['queued', 'parsing', 'failed', 'undone'].includes(row.status)) return row;

  try {
    const created = await createJobRequest(
      ctx,
      importEntity(importId),
      sourceIdentity(row),
      { type: STATEMENT_JOB_TYPE, userId: ctx.profileId, refId: importId },
      async (tx) => {
        const current = await lockedImport(tx, ctx, importId);
        if (!current || !['queued', 'parsing', 'failed', 'undone'].includes(current.status))
          throw new UnchangedImport(current);
        if (sourceIdentity(current) !== sourceIdentity(row))
          throw new JobEffectError('conflict', 'Statement identity changed during retry');
        const [r] = await tx
          .update(finStatementImports)
          .set({ status: 'queued', errorCode: null, errorMessage: null, finishedAt: null })
          .where(eq(finStatementImports.id, importId))
          .returning();
        return r;
      },
    );
    kick(created.jobId);
    return created.value;
  } catch (e) {
    if (e instanceof UnchangedImport) return e.row;
    throw e;
  }
}

/** Delete every persisted transaction for this import and mark it 'undone'
 *  (next_chunk/counts back to zero) — atomically, in one transaction. Does
 *  NOT re-enqueue; call retry (or re-submit the same content) to re-ingest
 *  — both reset 'undone' back to 'queued' + enqueue. Rejects with 409 while
 *  the import is actively 'parsing' (simplest serialization: don't undo out
 *  from under an in-flight chunk write). */
export async function undoImport(
  ctx: CoreCtx,
  importId: string,
): Promise<FinStatementImport | null> {
  try {
    return await revokeJobRequest(ctx, importEntity(importId), async (tx) => {
      const row = await lockedImport(tx, ctx, importId);
      if (!row) throw new UnchangedImport(null);
      if (row.status === 'parsing') {
        throw error(409, 'cannot undo an import while it is actively parsing');
      }

      await tx.delete(finTransactions).where(eq(finTransactions.importId, importId));
      const [updated] = await tx
        .update(finStatementImports)
        .set({
          status: 'undone',
          nextChunk: 0,
          rowCount: null,
          insertedCount: 0,
          rejectedCount: 0,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
        })
        .where(eq(finStatementImports.id, importId))
        .returning();
      return updated;
    });
  } catch (e) {
    if (e instanceof UnchangedImport) return e.row;
    throw e;
  }
}
