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
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  finStatementImports,
  finTransactions,
  type FinStatementImport,
} from '$server/db/pg-finance-schema';
import { uploadFile, getFileUrl } from './file.service';
import {
  registerJobHandler,
  enqueueJob,
  advanceJob,
  type AdvanceResult,
  type BgJob,
} from './bg-runtime';
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

/** Enqueue the ingest job and kick it once so a persistent runtime (localhost
 *  / adapter-node) can make immediate progress; the cron tick resumes it if
 *  the process is frozen mid-flight (serverless). Mirrors finance-sync's POST. */
async function enqueueAndKick(ctx: CoreCtx, importId: string): Promise<void> {
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    userId: ctx.profileId ?? null,
    type: STATEMENT_JOB_TYPE,
    refId: importId,
  });
  void advanceJob(jobId, Number.POSITIVE_INFINITY).catch((e) =>
    console.error('[finance-statements] advanceJob failed', e),
  );
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
 * checked BEFORE any storage write, so re-submitting identical content never
 * re-uploads or duplicates a row — UNIQUE(org_id, content_sha256) is the
 * backstop against a concurrent-request race.
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
      const requeued = await withOrgCore(ctx, async (tx) => {
        const [r] = await tx
          .update(finStatementImports)
          .set({ status: 'queued', errorCode: null, errorMessage: null, finishedAt: null })
          .where(eq(finStatementImports.id, existing.id))
          .returning();
        return r;
      });
      await enqueueAndKick(ctx, existing.id);
      return { import: requeued, created: false };
    }
    return { import: existing, created: false };
  }

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
    row = await withOrgCore(ctx, async (tx) => {
      const [inserted] = await tx
        .insert(finStatementImports)
        .values({
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
    });
  } catch (e) {
    // Lost a race against UNIQUE(org_id, content_sha256) — another request
    // created it first; return that row instead of duplicating.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      const raced = await findBySha(ctx, sha);
      if (raced) return { import: raced, created: false };
    }
    throw e;
  }

  await enqueueAndKick(ctx, row.id);
  return { import: row, created: true };
}

async function loadImportText(ctx: CoreCtx, row: FinStatementImport): Promise<string> {
  if (!row.fileId) throw new Error('import has no stored content');
  const file = await getFileUrl(ctx, row.fileId);
  if (!file) throw new Error('stored statement content not found');
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`failed to fetch statement content (${res.status})`);
  return res.text();
}

/** One bounded step: parse (deterministic, re-run every call — cheap for
 *  statement-sized files) and persist the next CHUNK_SIZE rows starting at
 *  `next_chunk`. Insert uses onConflictDoNothing on (import_id, source_row),
 *  so re-running the same chunk (retry, or a resumed lease) never duplicates. */
export async function persistImportChunk(ctx: CoreCtx, importId: string): Promise<AdvanceResult> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(finStatementImports)
      .where(and(eq(finStatementImports.id, importId), eq(finStatementImports.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) return { done: true, error: 'import not found' };
    if (row.status === 'done') return { done: true };
    if (row.status === 'failed') return { done: true, error: row.errorMessage ?? 'import failed' };

    let parsed: StatementParseResult;
    try {
      const text = await loadImportText(ctx, row);
      parsed = parseStatementCsv(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await tx
        .update(finStatementImports)
        .set({
          status: 'failed',
          errorCode: 'parse_failed',
          errorMessage: message,
          finishedAt: new Date(),
        })
        .where(eq(finStatementImports.id, importId));
      return { done: true, error: message };
    }

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
    // Conditional on the next_chunk we read at the top of this call: if a
    // stale/concurrent worker already advanced the cursor since then, this
    // WHERE matches zero rows and the update no-ops instead of double-adding
    // insertedCount/rejectedCount on top of the other worker's advance.
    await tx
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
        and(eq(finStatementImports.id, importId), eq(finStatementImports.nextChunk, row.nextChunk)),
      );

    return { done };
  });
}

async function advanceStatementIngest(job: BgJob): Promise<AdvanceResult> {
  if (!job.refId) return { done: true, error: 'missing refId' };
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: job.tenantId };
  return persistImportChunk(ctx, job.refId);
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

/** Reuse the same import: reset a failed OR undone job back to 'queued' and
 *  re-enqueue. Resumes from the existing `next_chunk` (0 for 'undone', since
 *  undo already zeroed it — no re-work of already-persisted rows for
 *  'failed'). No-op (returns the row as-is) for any other status. */
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
  if (row.status !== 'failed' && row.status !== 'undone') return row;

  const updated = await withOrgCore(ctx, async (tx) => {
    const [r] = await tx
      .update(finStatementImports)
      .set({ status: 'queued', errorCode: null, errorMessage: null, finishedAt: null })
      .where(eq(finStatementImports.id, importId))
      .returning();
    return r;
  });
  await enqueueAndKick(ctx, importId);
  return updated;
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
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(finStatementImports)
      .where(and(eq(finStatementImports.id, importId), eq(finStatementImports.orgId, ctx.tenantId)))
      .limit(1);
    if (!row) return null;
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
}
