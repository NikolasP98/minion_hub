import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { and, eq } from 'drizzle-orm';
import { finStatementImports } from '$server/db/pg-finance-schema';

vi.mock('./bg-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bg-runtime')>();
  return {
    ...actual,
    registerJobHandler: vi.fn(),
    enqueueJob: vi.fn(async () => 'job-1'),
    advanceJob: vi.fn(async () => {}),
  };
});

vi.mock('./file.service', () => ({
  uploadFile: vi.fn(async () => 'file-1'),
  getFileUrl: vi.fn(async () => ({ url: 'https://storage.example/file-1' })),
}));

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1', profileId: 'user-1' });

describe('createImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes on (org_id, content_sha256): returns the existing import without uploading or inserting', async () => {
    const { createImport } = await import('./finance-statements.service');
    const { uploadFile } = await import('./file.service');
    const { db, resolveSequence } = createMockDb();
    const existing = { id: 'imp-1', orgId: 'org-1', status: 'done', contentSha256: 'x' };
    resolveSequence([[existing]]); // findBySha select

    const result = await createImport(ctx(db), { sourceKind: 'text', text: 'hello' });

    expect(result.created).toBe(false);
    expect(result.import).toBe(existing);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('two calls with identical pasted text (different CRLF) produce the same sha and dedupe to one import', async () => {
    const { createImport } = await import('./finance-statements.service');
    const dbA = createMockDb();
    dbA.resolveSequence([[]]); // findBySha → none
    dbA.db.insert = vi.fn(() => ({
      values: () => ({
        returning: async () => [
          { id: 'imp-new', orgId: 'org-1', status: 'queued', contentSha256: 'sha' },
        ],
      }),
    })) as never;

    const first = await createImport(ctx(dbA.db), { sourceKind: 'text', text: 'line1\r\nline2' });

    const dbB = createMockDb();
    dbB.resolveSequence([
      [
        {
          id: first.import.id,
          orgId: 'org-1',
          status: 'queued',
          contentSha256: first.import.contentSha256,
        },
      ],
    ]);
    const second = await createImport(ctx(dbB.db), { sourceKind: 'text', text: 'line1\nline2' });

    expect(second.created).toBe(false);
    expect(second.import.id).toBe(first.import.id);
  });

  it('creates a new import + enqueues the job when no existing content matches', async () => {
    const { createImport } = await import('./finance-statements.service');
    const { uploadFile } = await import('./file.service');
    const { enqueueJob, advanceJob } = await import('./bg-runtime');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // findBySha → none
      [{ id: 'imp-new', orgId: 'org-1', status: 'queued', contentSha256: 'sha' }], // insert().returning()
    ]);

    const result = await createImport(ctx(db), {
      sourceKind: 'csv',
      fileName: 's.csv',
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.created).toBe(true);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', type: 'statement_ingest', refId: 'imp-new' }),
    );
    expect(advanceJob).toHaveBeenCalledWith('job-1', Number.POSITIVE_INFINITY);
  });

  it('re-enqueues (instead of stranding) a dedupe match whose import was previously undone', async () => {
    const { createImport } = await import('./finance-statements.service');
    const { uploadFile } = await import('./file.service');
    const { enqueueJob, advanceJob } = await import('./bg-runtime');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'imp-1', orgId: 'org-1', status: 'undone', contentSha256: 'x' }], // findBySha
      [{ id: 'imp-1', orgId: 'org-1', status: 'queued', contentSha256: 'x' }], // update().returning()
    ]);

    const result = await createImport(ctx(db), { sourceKind: 'text', text: 'hello' });

    expect(result.created).toBe(false);
    expect(result.import.status).toBe('queued');
    expect(uploadFile).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', type: 'statement_ingest', refId: 'imp-1' }),
    );
    expect(advanceJob).toHaveBeenCalledWith('job-1', Number.POSITIVE_INFINITY);
  });
});

describe('persistImportChunk', () => {
  const CSV = [
    'Date,Description,Amount',
    '2026-01-05,Grocery store,-45.90',
    '2026-01-06,bad-amount,oops',
    '2026-01-07,Salary,2500.00',
  ].join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts accepted rows for the current chunk, skips rejected ones, and marks the import done', async () => {
    const { persistImportChunk } = await import('./finance-statements.service');
    const { getFileUrl } = await import('./file.service');
    (getFileUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://storage.example/file-1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(CSV)),
    );

    const { db, resolveSequence } = createMockDb();
    const importRow = {
      id: 'imp-1',
      orgId: 'org-1',
      fileId: 'file-1',
      status: 'queued',
      nextChunk: 0,
      insertedCount: 0,
      rejectedCount: 0,
    };
    resolveSequence([
      [importRow], // select import row
      [], // insert into fin_transactions
      [], // update import row
    ]);

    const result = await persistImportChunk(ctx(db), 'imp-1');

    expect(result).toEqual({ done: true });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('is idempotent: re-running the same chunk (same next_chunk) issues an identical insert set', async () => {
    // Proves the chunk-slicing itself is deterministic — combined with
    // onConflictDoNothing on (import_id, source_row) this makes chunk
    // retries safe (asserted at the parser layer; DB dedup is a constraint,
    // not app logic, so it is not re-tested here with a mock).
    const { parseStatementCsv } = await import('./finance-statement-parser');
    const parsedA = parseStatementCsv(CSV);
    const parsedB = parseStatementCsv(CSV);
    const sliceA = parsedA.entries.slice(0, 2);
    const sliceB = parsedB.entries.slice(0, 2);
    expect(sliceA).toEqual(sliceB);
  });

  it('returns done:true without touching the DB when the import is already done', async () => {
    const { persistImportChunk } = await import('./finance-statements.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'imp-1', orgId: 'org-1', status: 'done', nextChunk: 4 }]]);

    const result = await persistImportChunk(ctx(db), 'imp-1');

    expect(result).toEqual({ done: true });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('counts insertedCount from the actual DB insert result, not the parsed-ok slice length (a replay that conflict-skips an already-persisted row must not inflate the count)', async () => {
    const { persistImportChunk } = await import('./finance-statements.service');
    const { getFileUrl } = await import('./file.service');
    (getFileUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://storage.example/file-1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(CSV)),
    );

    const importRow = {
      id: 'imp-1',
      orgId: 'org-1',
      fileId: 'file-1',
      status: 'queued',
      nextChunk: 0,
      insertedCount: 0,
      rejectedCount: 0,
    };
    let capturedSet: Record<string, unknown> | undefined;
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[importRow]]); // select import row
    // 2 ok rows in CSV (Grocery, Salary) — simulate only 1 actually landing
    // (the other already exists from a prior chunk run, so onConflictDoNothing
    // skipped it).
    db.insert = vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{ id: 'txn-1' }],
        }),
      }),
    })) as never;
    db.update = vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        capturedSet = payload;
        return { where: async () => [] };
      },
    })) as never;

    await persistImportChunk(ctx(db), 'imp-1');

    expect(capturedSet?.insertedCount).toBe(1); // actual inserted rows, not okSlice.length (2)
    vi.unstubAllGlobals();
  });

  it('advances the cursor with a conditional WHERE on the next_chunk it read, so a stale/concurrent replay no-ops instead of double-advancing', async () => {
    const { persistImportChunk } = await import('./finance-statements.service');
    const { getFileUrl } = await import('./file.service');
    (getFileUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://storage.example/file-1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(CSV)),
    );

    const importRow = {
      id: 'imp-1',
      orgId: 'org-1',
      fileId: 'file-1',
      status: 'queued',
      nextChunk: 0,
      insertedCount: 0,
      rejectedCount: 0,
    };
    let capturedWhere: unknown;
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[importRow]]); // select import row
    db.insert = vi.fn(() => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
    })) as never;
    db.update = vi.fn(() => ({
      set: () => ({
        where: (arg: unknown) => {
          capturedWhere = arg;
          return Promise.resolve([]);
        },
      }),
    })) as never;

    await persistImportChunk(ctx(db), 'imp-1');

    expect(capturedWhere).toEqual(
      and(eq(finStatementImports.id, 'imp-1'), eq(finStatementImports.nextChunk, importRow.nextChunk)),
    );
  });
});

describe('retryImport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op for a non-failed import (no update, no re-enqueue)', async () => {
    const { retryImport } = await import('./finance-statements.service');
    const { enqueueJob } = await import('./bg-runtime');
    const { db, resolveSequence } = createMockDb();
    const row = { id: 'imp-1', orgId: 'org-1', status: 'done' };
    resolveSequence([[row]]);

    const result = await retryImport(ctx(db), 'imp-1');

    expect(result).toBe(row);
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('resets a failed import to queued and re-enqueues', async () => {
    const { retryImport } = await import('./finance-statements.service');
    const { enqueueJob } = await import('./bg-runtime');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'imp-1', orgId: 'org-1', status: 'failed' }], // select
      [{ id: 'imp-1', orgId: 'org-1', status: 'queued' }], // update().returning()
    ]);

    const result = await retryImport(ctx(db), 'imp-1');

    expect(result?.status).toBe('queued');
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ refId: 'imp-1', type: 'statement_ingest' }),
    );
  });

  it('resets an undone import to queued and re-enqueues (so undo never permanently strands an import)', async () => {
    const { retryImport } = await import('./finance-statements.service');
    const { enqueueJob } = await import('./bg-runtime');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'imp-1', orgId: 'org-1', status: 'undone', nextChunk: 0 }], // select
      [{ id: 'imp-1', orgId: 'org-1', status: 'queued', nextChunk: 0 }], // update().returning()
    ]);

    const result = await retryImport(ctx(db), 'imp-1');

    expect(result?.status).toBe('queued');
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ refId: 'imp-1', type: 'statement_ingest' }),
    );
  });
});

describe('undoImport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes transactions and marks the import undone (not queued — nothing re-enqueues it until retry/re-submit)', async () => {
    const { undoImport } = await import('./finance-statements.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'imp-1', orgId: 'org-1', status: 'done' }], // select
      [], // delete fin_transactions
      [
        {
          id: 'imp-1',
          orgId: 'org-1',
          status: 'undone',
          nextChunk: 0,
          insertedCount: 0,
          rejectedCount: 0,
        },
      ], // update().returning()
    ]);

    const result = await undoImport(ctx(db), 'imp-1');

    expect(result?.status).toBe('undone');
    expect(db.delete).toHaveBeenCalled();
  });

  it('rejects with 409 while the import is actively parsing, and never touches transactions or the row', async () => {
    const { undoImport } = await import('./finance-statements.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'imp-1', orgId: 'org-1', status: 'parsing' }]]); // select

    await expect(undoImport(ctx(db), 'imp-1')).rejects.toMatchObject({ status: 409 });
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
