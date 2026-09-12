import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { BgJob, JobExecution } from './bg-runtime';
import type { FinStatementImport } from '$server/db/pg-finance-schema';

const effects = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  owned: vi.fn(),
  result: vi.fn(),
}));
vi.mock('./job-effects.service', async (original) => ({
  ...(await original<typeof import('./job-effects.service')>()),
  createJobRequest: effects.create,
  revokeJobRequest: effects.revoke,
  withJobRequest: effects.owned,
  jobRequestAdvanceResult: effects.result,
}));
vi.mock('./bg-runtime', async (original) => ({
  ...(await original<typeof import('./bg-runtime')>()),
  registerJobHandler: vi.fn(),
  advanceJob: vi.fn(async () => {}),
}));
vi.mock('./file.service', () => ({
  uploadFile: vi.fn(async () => 'file-1'),
  getFileUrl: vi.fn(async () => ({ url: 'https://storage.invalid/file-1' })),
}));
import {
  createImport,
  retryImport,
  undoImport,
  persistImportChunk,
  getImportStatus,
  STATEMENT_JOB_TYPE,
} from './finance-statements.service';
import { uploadFile, getFileUrl } from './file.service';
import { advanceJob } from './bg-runtime';
import { parseStatementCsv, STATEMENT_PARSER_VERSION } from './finance-statement-parser';
vi.mock('./finance-statement-parser', async (original) => {
  const actual = await original<typeof import('./finance-statement-parser')>();
  return { ...actual, parseStatementCsv: vi.fn(actual.parseStatementCsv) };
});

const CSV =
  'Date,Description,Amount\n2026-01-05,Grocery,-45.90\n2026-01-06,Bad,oops\n2026-01-07,Salary,2500.00';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const row = {
  id: 'imp-1',
  orgId: 'org-1',
  fileId: 'file-1',
  sourceKind: 'csv',
  status: 'queued',
  nextChunk: 0,
  insertedCount: 0,
  rejectedCount: 0,
  parserVersion: STATEMENT_PARSER_VERSION,
  contentSha256: hash(CSV),
} as FinStatementImport;
const request = {
  family: 'finance.statement',
  entityId: row.id,
  revision: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sourceHash: hash(JSON.stringify([row.contentSha256, STATEMENT_PARSER_VERSION])),
};
const job = {
  id: 'job-1',
  tenantId: 'org-1',
  type: STATEMENT_JOB_TYPE,
  refId: row.id,
  cursor: JSON.stringify({ __jobRequest: request }),
} as BgJob;
let mock: ReturnType<typeof createMockDb>, ctx: CoreCtx, execution: JobExecution;
beforeEach(() => {
  vi.clearAllMocks();
  mock = createMockDb();
  ctx = { db: mock.db as never, tenantId: 'org-1' };
  execution = {
    jobId: job.id,
    tenantId: job.tenantId,
    signal: new AbortController().signal,
  } as JobExecution;
  effects.create.mockImplementation(
    async (...args: Parameters<typeof import('./job-effects.service').createJobRequest>) => ({
      jobId: 'new-job',
      request,
      value: await args[4](ctx.db as never, request),
    }),
  );
  effects.revoke.mockImplementation(
    async (...args: Parameters<typeof import('./job-effects.service').revokeJobRequest>) =>
      args[2](ctx.db as never),
  );
  effects.owned.mockImplementation(
    async (...args: Parameters<typeof import('./job-effects.service').withJobRequest>) =>
      args[3](ctx.db as never, job),
  );
  effects.result.mockImplementation(
    async (_execution: JobExecution, _ctx: CoreCtx, _request: unknown, done: boolean) => ({
      done,
      cursor: { __jobRequest: request },
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(CSV)),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(parseStatementCsv).mockReset();
});

describe('statement boundaries (native tests prove transactions)', () => {
  it('rejects cancelled ownership before any domain or file read', async () => {
    execution.signal = AbortSignal.abort();
    await expect(persistImportChunk(ctx, job, execution)).rejects.toMatchObject({
      code: 'ownership_lost',
    });
    expect(effects.owned).not.toHaveBeenCalled();
    expect(getFileUrl).not.toHaveBeenCalled();
  });
  it('rejects unversioned or mismatched jobs before file retrieval', async () => {
    for (const invalid of [
      { ...job, cursor: null },
      { ...job, tenantId: 'other' },
      { ...job, cursor: JSON.stringify({ __jobRequest: { ...request, entityId: 'other' } }) },
    ])
      await expect(persistImportChunk(ctx, invalid, execution)).rejects.toMatchObject({
        code: 'conflict',
      });
    expect(effects.owned).not.toHaveBeenCalled();
    expect(getFileUrl).not.toHaveBeenCalled();
  });
  it('dedupes completed content before blob upload', async () => {
    mock.resolveSequence([[{ ...row, status: 'done' }]]);
    expect((await createImport(ctx, { sourceKind: 'text', text: CSV })).created).toBe(false);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(effects.create).not.toHaveBeenCalled();
  });
  it('creates atomically and kicks only the committed job', async () => {
    mock.resolveSequence([[], [row]]);
    expect(
      (await createImport(ctx, { sourceKind: 'text', text: CSV.replaceAll('\n', '\r\n') })).created,
    ).toBe(true);
    expect(effects.create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ family: 'finance.statement' }),
      request.sourceHash,
      expect.objectContaining({ type: STATEMENT_JOB_TYPE }),
      expect.any(Function),
    );
    expect(advanceJob).toHaveBeenCalledWith('new-job', Infinity);
    effects.create.mockRejectedValueOnce(new Error('rollback'));
    mock.resolveSequence([[]]);
    vi.mocked(advanceJob).mockClear();
    await expect(createImport(ctx, { sourceKind: 'text', text: 'different' })).rejects.toThrow(
      'rollback',
    );
    expect(advanceJob).not.toHaveBeenCalled();
  });
  it.each(['queued', 'parsing', 'failed', 'undone'])(
    'explicit retry replaces %s without resetting progress',
    async (status) => {
      const existing = { ...row, status, nextChunk: 500, insertedCount: 498, rejectedCount: 2 };
      mock.resolveSequence([[existing], [existing], [{ ...existing, status: 'queued' }]]);
      const result = await retryImport(ctx, row.id);
      expect(result).toMatchObject({
        nextChunk: 500,
        insertedCount: 498,
        rejectedCount: 2,
        status: 'queued',
      });
      expect(effects.create).toHaveBeenCalledTimes(1);
      expect(advanceJob).toHaveBeenCalledWith('new-job', Infinity);
    },
  );
  it('returns a concurrently completed import before domain update', async () => {
    mock.resolveSequence([[row], [{ ...row, status: 'done' }]]);
    expect(await retryImport(ctx, row.id)).toMatchObject({ status: 'done' });
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(advanceJob).not.toHaveBeenCalled();
  });
  it('retains parsing undo409 without domain deletion', async () => {
    mock.resolveSequence([[{ ...row, status: 'parsing' }]]);
    await expect(undoImport(ctx, row.id)).rejects.toMatchObject({ status: 409 });
    expect(effects.revoke).toHaveBeenCalledTimes(1);
    expect(mock.db.delete).not.toHaveBeenCalled();
  });
  it('records source hash mismatch only through owned failure boundary', async () => {
    mock.resolveSequence([[row], [row], []]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('changed content'));
    expect(await persistImportChunk(ctx, job, execution)).toMatchObject({
      done: true,
      error: 'stored statement content hash mismatch',
    });
    expect(effects.owned).toHaveBeenCalledTimes(2);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });
  it('rejects a failed cursor CAS after inserting rows', async () => {
    mock.resolveSequence([[row], [row], [{ id: 'only-one-inserted' }], []]);
    await expect(persistImportChunk(ctx, job, execution)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(mock.db.insert).toHaveBeenCalledTimes(1);
    expect(effects.result).not.toHaveBeenCalled();
  });
  it('passes cancellation to fetch and suppresses late content', async () => {
    const abort = new AbortController();
    execution.signal = abort.signal;
    mock.resolveSequence([[row]]);
    vi.mocked(fetch).mockImplementationOnce(async () => {
      abort.abort();
      return new Response(CSV);
    });
    await expect(persistImportChunk(ctx, job, execution)).rejects.toMatchObject({
      code: 'ownership_lost',
    });
    expect(fetch).toHaveBeenCalledWith('https://storage.invalid/file-1', { signal: abort.signal });
    expect(mock.db.update).not.toHaveBeenCalled();
  });
});

const VERSION_CONFLICT =
  'Statement parser version mismatch; historical import recovery requires explicit review';
function boundImport(overrides: Partial<FinStatementImport>) {
  const current = { ...row, ...overrides };
  return {
    current,
    boundJob: {
      ...job,
      cursor: JSON.stringify({
        __jobRequest: {
          ...request,
          sourceHash: hash(JSON.stringify([current.contentSha256, current.parserVersion])),
        },
      }),
    },
  };
}
describe('parser version and provenance binding', () => {
  it.each(
    [1, 2].flatMap((version) =>
      ['queued', 'parsing'].flatMap((status) =>
        [0, 500].map((nextChunk) => ({ version, status, nextChunk })),
      ),
    ),
  )(
    'rejects stale $version/$status cursor $nextChunk before file access or writes',
    async ({ version, status, nextChunk }) => {
      const { current, boundJob } = boundImport({ parserVersion: version, status, nextChunk });
      mock.resolveSequence([[current]]);
      await expect(persistImportChunk(ctx, boundJob, execution)).rejects.toMatchObject({
        code: 'conflict',
        message: VERSION_CONFLICT,
      });
      expect(getFileUrl).not.toHaveBeenCalled();
      expect(parseStatementCsv).not.toHaveBeenCalled();
      expect(mock.db.insert).not.toHaveBeenCalled();
      expect(mock.db.update).not.toHaveBeenCalled();
    },
  );
  it.each(['queued', 'parsing', 'failed', 'undone'])(
    'refuses historical %s retry before admission',
    async (status) => {
      mock.resolveSequence([[{ ...row, parserVersion: 1, status }]]);
      await expect(retryImport(ctx, row.id)).rejects.toMatchObject({
        status: 409,
        body: { message: VERSION_CONFLICT },
      });
      expect(effects.create).not.toHaveBeenCalled();
      expect(mock.db.update).not.toHaveBeenCalled();
    },
  );
  it('rechecks parser version in the locked retry callback', async () => {
    mock.resolveSequence([[row], [{ ...row, parserVersion: 2 }]]);
    await expect(retryImport(ctx, row.id)).rejects.toMatchObject({
      status: 409,
      body: { message: VERSION_CONFLICT },
    });
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(advanceJob).not.toHaveBeenCalled();
  });
  it.each(['done', 'failed'])(
    'returns exact historical %s without parsing or relabeling',
    async (status) => {
      const { current, boundJob } = boundImport({
        parserVersion: 1,
        status,
        nextChunk: 500,
        errorMessage: status === 'failed' ? 'Historical fixed failure' : null,
      });
      mock.resolveSequence([[current]]);
      expect(await persistImportChunk(ctx, boundJob, execution)).toMatchObject({ done: true });
      expect(getFileUrl).not.toHaveBeenCalled();
      expect(parseStatementCsv).not.toHaveBeenCalled();
      expect(mock.db.update).not.toHaveBeenCalled();
    },
  );
  it.each(['done', 'parsing'])(
    'does not attach v3 rejection samples to historical %s',
    async (status) => {
      const historical = { ...row, parserVersion: 1, status, nextChunk: 500 };
      mock.resolveSequence([[historical]]);
      expect(await getImportStatus(ctx, row.id)).toEqual({ import: historical, rejections: [] });
      expect(getFileUrl).not.toHaveBeenCalled();
      expect(parseStatementCsv).not.toHaveBeenCalled();
    },
  );
  it('current status still returns its bounded actual parser rejection', async () => {
    mock.resolveSequence([[{ ...row, status: 'done' }]]);
    expect((await getImportStatus(ctx, row.id))?.rejections).toMatchObject([{ sourceRow: 2 }]);
    expect(parseStatementCsv).toHaveBeenCalledTimes(1);
  });
  it('checks stored bytes on status reads before parser access', async () => {
    mock.resolveSequence([[{ ...row, status: 'done' }]]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('corrupted'));
    expect((await getImportStatus(ctx, row.id))?.rejections).toEqual([]);
    expect(parseStatementCsv).not.toHaveBeenCalled();
  });
  it.each(['version', 'digest'])(
    'rejects wrong returned provenance %s outside failure persistence',
    async (field) => {
      const actual = await vi.importActual<typeof import('./finance-statement-parser')>(
        './finance-statement-parser',
      );
      vi.mocked(parseStatementCsv).mockImplementationOnce((text) => {
        const result = actual.parseStatementCsv(text);
        return {
          ...result,
          provenance: {
            ...result.provenance,
            ...(field === 'version' ? { parserVersion: 1 } : { sourceSha256: '0'.repeat(64) }),
          },
        };
      });
      mock.resolveSequence([[row]]);
      await expect(persistImportChunk(ctx, job, execution)).rejects.toMatchObject({
        code: 'conflict',
        message: 'Statement parse provenance mismatch',
      });
      expect(mock.db.update).not.toHaveBeenCalled();
      expect(mock.db.insert).not.toHaveBeenCalled();
    },
  );
  it.each([
    'Date,Description,Amount\n2026-01-01,Sample,1'.replaceAll('\n', '\r\n'),
    '\uFEFFDate,Description,Amount\n2026-01-01,Sample,1',
  ])('accepts distinct raw and normalized hashes', async (text) => {
    const { current, boundJob } = boundImport({ contentSha256: hash(text) });
    mock.resolveSequence([[current], [current], [{ id: 'inserted' }], [{ id: row.id }]]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(text));
    expect(await persistImportChunk(ctx, boundJob, execution)).toMatchObject({ done: true });
    expect(mock.db.insert).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['record-too-large', 'Date,Description,' + 'S'.repeat(4097) + 'SECRET_HEADER'],
    ['malformed-quoting', 'Date,"SECRET_HEADER'],
    ['invalid-encoding', 'Date,Description,Amount\uFFFDSECRET_HEADER'],
  ])('keeps actual %s header diagnostics content-free', async (reason, header) => {
    const text = header + '\n2026-01-01,Sample,1';
    const { current, boundJob } = boundImport({ contentSha256: hash(text) });
    mock.resolveSequence([[current], [current], []]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(text));
    const result = await persistImportChunk(ctx, boundJob, execution);
    expect(result).toMatchObject({ done: true, error: `Invalid statement header: ${reason}` });
    expect(JSON.stringify(result)).not.toContain('SECRET_HEADER');
    expect(mock.db.insert).not.toHaveBeenCalled();
  });
  it('does not persist an arbitrary external error message', async () => {
    mock.resolveSequence([[row], [row], []]);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('SECRET_TRANSPORT_PAYLOAD'));
    const result = await persistImportChunk(ctx, job, execution);
    expect(result).toMatchObject({ done: true, error: 'Statement parsing failed' });
    expect(JSON.stringify(result)).not.toContain('SECRET_TRANSPORT_PAYLOAD');
  });
});

describe('fixed typed parser diagnostics', () => {
  it('reconstructs header diagnostics instead of forwarding a mutated Error.message', async () => {
    const actual = await vi.importActual<typeof import('./finance-statement-parser')>(
      './finance-statement-parser',
    );
    const failure = new actual.StatementParseHeaderError('malformed-quoting');
    failure.message = 'SECRET_MUTATED_HEADER';
    vi.mocked(parseStatementCsv).mockImplementationOnce(() => {
      throw failure;
    });
    mock.resolveSequence([[row], [row], []]);
    expect(await persistImportChunk(ctx, job, execution)).toMatchObject({
      done: true,
      error: 'Invalid statement header: malformed-quoting',
    });
  });
  it('retains a fixed whole-input limit classification without arbitrary message text', async () => {
    const actual = await vi.importActual<typeof import('./finance-statement-parser')>(
      './finance-statement-parser',
    );
    const failure = new actual.StatementParseLimitError('too-many-rows', 100000, 100001);
    failure.message = 'SECRET_MUTATED_LIMIT';
    vi.mocked(parseStatementCsv).mockImplementationOnce(() => {
      throw failure;
    });
    mock.resolveSequence([[row], [row], []]);
    expect(await persistImportChunk(ctx, job, execution)).toMatchObject({
      done: true,
      error: 'Statement input limit exceeded: too-many-rows',
    });
  });
});
