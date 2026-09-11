import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({
  pool: vi.fn(),
  upload: vi.fn(),
  file: vi.fn(),
  registered: vi.fn(),
}));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('./file.service', () => ({ uploadFile: boundary.upload, getFileUrl: boundary.file }));
vi.mock('./bg-runtime', async (original) => {
  const actual = await original<typeof import('./bg-runtime')>();
  return {
    ...actual,
    registerJobHandler: (handler: Parameters<typeof actual.registerJobHandler>[0]) => {
      boundary.registered(handler);
      actual.registerJobHandler(handler);
    },
  };
});
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { advanceJob, enqueueJob, registerJobHandler, type JobHandler } from './bg-runtime';
import { createJobRequest, readJobRequest } from './job-effects.service';
import {
  createImport,
  undoImport,
  retryImport,
  getImportStatus,
  STATEMENT_JOB_TYPE,
} from './finance-statements.service';
import { parseStatementCsv } from './finance-statement-parser';
import { finStatementImports } from '$server/db/pg-finance-schema';

type Client = ReturnType<typeof postgres>;
const context = new AsyncLocalStorage<Client>();
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client, a: Client, b: Client;
let backendIds: number[];
let originalHandler: JobHandler;
const ORG = 'qc-finance-a',
  OTHER = 'qc-finance-b';
const CSV =
  'Date,Description,Amount\n2026-01-05,Grocery,-45.90\n2026-01-06,Bad,oops\n2026-01-07,Salary,2500.00';
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const files = new Map<string, string>();
const outstanding = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
const scope = (tenantId = ORG) => ({ db: getCoreDb(), tenantId });
const on = <T>(client: Client, work: () => Promise<T>) => {
  const promise = context.run(client, work);
  outstanding.add(promise);
  void promise.then(
    () => outstanding.delete(promise),
    () => outstanding.delete(promise),
  );
  return promise;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  releases.add(() => resolve(undefined as T));
  return { promise, resolve };
}
async function until(test: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await test())) {
    if (Date.now() > deadline) throw new Error('Finance fixture boundary was not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function state(id: string) {
  const [row] = await owner`select * from fin_statement_imports where id=${id}`;
  const transactions =
    await owner`select * from fin_transactions where import_id=${id} order by source_row`;
  const jobs = await owner`select * from bg_jobs where ref_id=${id} order by created_at,id`;
  const [head] = await owner`select * from job_effects where entity_id=${id} and kind='head'`;
  return { row: row!, transactions, jobs, head };
}
async function seed(text = CSV, status = 'queued', next = 0) {
  const id = randomUUID(),
    file = randomUUID();
  files.set(file, text);
  const contentHash = hash(text);
  const created = await on(a, () =>
    createJobRequest(
      scope(),
      { family: 'finance.statement', entityId: id },
      hash(JSON.stringify([contentHash, 1])),
      { type: STATEMENT_JOB_TYPE, refId: id },
      async (tx) => {
        await tx.execute(sql`insert into fin_statement_imports
        (id,org_id,file_id,source_kind,content_sha256,parser_version,status,next_chunk,inserted_count,rejected_count)
        values (${id},${ORG},${file},'csv',${contentHash},1,${status},${next},0,0)`);
      },
    ),
  );
  return { id, file, ...created };
}
async function duplicate(created: Awaited<ReturnType<typeof seed>>, client = b) {
  return on(client, () =>
    enqueueJob({
      tenantId: ORG,
      type: STATEMENT_JOB_TYPE,
      refId: created.id,
      cursor: { __jobRequest: created.request },
    }),
  );
}
async function idleJobs(id: string) {
  await until(async () =>
    (await state(id)).jobs.every((job) => !['queued', 'running'].includes(job.status)),
  );
}
beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
    CREATE TABLE bg_jobs (id text primary key, tenant_id text not null, user_id text, type text not null,
      ref_id text, status text not null default 'queued', cursor text, error text, attempts integer not null default 0,
      lease_until bigint, created_at bigint not null, updated_at bigint not null, started_at bigint, finished_at bigint);`);
  for (const file of [
    '20260909090100_bg_job_lease_generation.sql',
    '20260909090300_job_effect_receipts.sql',
    '20260909090400_job_request_manifest.sql',
    '20260722234500_fin_statement_imports.sql',
  ]) {
    const ddl = readFileSync(
      new URL(`../../../supabase/migrations/${file}`, import.meta.url),
      'utf8',
    );
    await owner.unsafe(ddl.replaceAll('public.', `"${schema}".`));
  }
  await owner.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO app_ledger`);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  const ids = await Promise.all(
    [a, b].map(
      async (client) =>
        (
          await client`select pg_backend_pid() pid,
    current_database() as database, shobj_description(oid,'pg_database') as marker
    from pg_database where datname=current_database()`
        )[0],
    ),
  );
  ids.forEach((id) =>
    expect(id).toMatchObject({
      database: harness.identity.database,
      marker: harness.identity.marker,
    }),
  );
  expect(ids[0]?.pid).not.toBe(ids[1]?.pid);
  backendIds = ids.map((id) => Number(id!.pid));
  owner = harness.createConnection(schema);
  boundary.pool.mockImplementation(() => context.getStore() ?? a);
  originalHandler = boundary.registered.mock.calls
    .map(([handler]) => handler as JobHandler)
    .find((handler) => handler.type === STATEMENT_JOB_TYPE)!;
  expect(originalHandler).toBeDefined();
}, 20000);
beforeEach(async () => {
  await owner.unsafe('TRUNCATE fin_transactions,fin_statement_imports,bg_jobs,job_effects');
  files.clear();
  boundary.upload.mockClear();
  boundary.file.mockClear();
  registerJobHandler(originalHandler);
  boundary.upload.mockImplementation(async (_ctx: unknown, input: { data: Uint8Array }) => {
    const id = randomUUID();
    files.set(id, new TextDecoder().decode(input.data));
    return id;
  });
  boundary.file.mockImplementation(async (_ctx: unknown, id: string) => ({
    url: `https://storage.invalid/${id}`,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const text = files.get(String(input).split('/').at(-1)!);
      if (text === undefined) throw new Error('Unknown synthetic file');
      return new Response(text);
    }),
  );
});
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...outstanding]);
  await until(
    async () => (await owner`select id from bg_jobs where status='running'`).length === 0,
  );
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (owner) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness?.close();
});

describe('native statement ownership', () => {
  it('content-unique creation races return one committed import and one request', async () => {
    const uploads = deferred<void>();
    boundary.upload.mockImplementation(async (_ctx: unknown, input: { data: Uint8Array }) => {
      await uploads.promise;
      const id = randomUUID();
      files.set(id, new TextDecoder().decode(input.data));
      return id;
    });
    const first = on(a, () => createImport(scope(), { sourceKind: 'text', text: CSV }));
    const second = on(b, () => createImport(scope(), { sourceKind: 'text', text: CSV }));
    await until(() => boundary.upload.mock.calls.length === 2);
    uploads.resolve();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]!.import.id).toBe(results[1]!.import.id);
    await idleJobs(results[0]!.import.id);
    const current = await state(results[0]!.import.id);
    expect(current.jobs).toHaveLength(1);
    expect(current.transactions).toHaveLength(2);
    expect(await owner`select id from job_effects`).toHaveLength(1);
  });

  it('creates, dedupes normalized content, and atomically commits parser output and progress', async () => {
    const created = await on(a, () =>
      createImport(scope(), { sourceKind: 'text', text: CSV.replaceAll('\n', '\r\n') }),
    );
    await idleJobs(created.import.id);
    const same = await on(b, () => createImport(scope(), { sourceKind: 'text', text: CSV }));
    expect(same.created).toBe(false);
    expect(same.import.id).toBe(created.import.id);
    expect(boundary.upload).toHaveBeenCalledTimes(1);
    const current = await state(created.import.id);
    expect(current.row).toMatchObject({
      status: 'done',
      next_chunk: 3,
      row_count: 3,
      inserted_count: 2,
      rejected_count: 1,
    });
    expect(current.transactions.map((row) => row.signed_amount)).toEqual(['-45.90', '2500.00']);
    expect(JSON.parse(current.jobs[0]!.cursor).nextChunk).toBe(3);
    expect(current.head?.revision).toBe(
      readJobRequest({ cursor: current.jobs[0]!.cursor })?.revision,
    );
    expect(
      (await on(a, () => getImportStatus(scope(), created.import.id)))?.rejections,
    ).toHaveLength(1);
  });

  it('serializes duplicate jobs without holding transactions open during file fetch', async () => {
    const created = await seed(),
      second = await duplicate(created);
    const firstFile = deferred<Response>(),
      secondFile = deferred<Response>();
    vi.mocked(fetch)
      .mockImplementationOnce(() => firstFile.promise)
      .mockImplementationOnce(() => secondFile.promise);
    const firstRun = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    const secondRun = on(b, () => advanceJob(second));
    await until(() => vi.mocked(fetch).mock.calls.length === 2);
    const clients = await owner`select state,xact_start from pg_stat_activity
      where pid in (${backendIds[0]!},${backendIds[1]!})`;
    expect(clients.length).toBeGreaterThanOrEqual(2);
    expect(clients.every((client) => client.xact_start === null && client.state === 'idle')).toBe(
      true,
    );
    firstFile.resolve(new Response(CSV));
    await firstRun;
    secondFile.resolve(new Response(CSV));
    await secondRun;
    const current = await state(created.id);
    expect(current.transactions).toHaveLength(2);
    expect(current.row).toMatchObject({
      inserted_count: 2,
      rejected_count: 1,
      next_chunk: 3,
      status: 'done',
    });
    expect(current.jobs.every((job) => job.status === 'done')).toBe(true);
  });

  it.each(['cancel', 'takeover', 'undo', 'retry'])(
    'fences a late file result after %s',
    async (mode) => {
      const created = await seed(),
        file = deferred<Response>();
      vi.mocked(fetch).mockImplementationOnce(() => file.promise);
      const run = on(a, () => advanceJob(created.jobId));
      await until(() => vi.mocked(fetch).mock.calls.length === 1);
      if (mode === 'cancel')
        await owner`update bg_jobs set status='cancelled',lease_generation=lease_generation+1 where id=${created.jobId}`;
      if (mode === 'takeover') {
        await owner`update bg_jobs set lease_until=0 where id=${created.jobId}`;
        await on(b, () => advanceJob(created.jobId));
      }
      if (mode === 'undo') await on(b, () => undoImport(scope(), created.id));
      if (mode === 'retry') {
        await on(b, () => retryImport(scope(), created.id));
        await until(async () => (await state(created.id)).row.status === 'done');
      }
      file.resolve(new Response(CSV));
      await run;
      const current = await state(created.id);
      expect(current.transactions).toHaveLength(mode === 'takeover' || mode === 'retry' ? 2 : 0);
      if (mode === 'undo')
        expect(current.row).toMatchObject({ status: 'undone', next_chunk: 0, error_code: null });
      if (mode === 'retry') expect(current.head?.revision).not.toBe(created.request.revision);
    },
  );

  it('undo then identical retry cannot let a queued first chunk resurrect the old request', async () => {
    const created = await seed(),
      blocked = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => blocked.promise);
    const old = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => undoImport(scope(), created.id));
    const retry = await on(b, () =>
      createImport(scope(), { sourceKind: 'csv', bytes: new TextEncoder().encode(CSV) }),
    );
    expect(retry.created).toBe(false);
    await until(async () => (await state(created.id)).row.status === 'done');
    blocked.resolve(new Response(CSV));
    await old;
    const current = await state(created.id);
    expect(current.transactions).toHaveLength(2);
    expect(current.row.inserted_count).toBe(2);
    expect(current.head?.revision).not.toBe(created.request.revision);
    expect(current.jobs.find((job) => job.id === created.jobId)?.error).toMatch(
      /superseded|revoked/,
    );
  });

  it('does not record a late file failure against an undone request', async () => {
    const created = await seed(),
      file = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => file.promise);
    const run = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => undoImport(scope(), created.id));
    file.resolve(new Response('unavailable', { status: 503 }));
    await run;
    expect((await state(created.id)).row).toMatchObject({
      status: 'undone',
      error_code: null,
      error_message: null,
    });
  });

  it('rolls back accepted rows when the cursor update fails', async () => {
    const created = await seed();
    await owner.unsafe(`CREATE FUNCTION reject_finance_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.next_chunk > OLD.next_chunk THEN RETURN NULL; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_finance_cursor BEFORE UPDATE ON fin_statement_imports
      FOR EACH ROW EXECUTE FUNCTION reject_finance_cursor()`);
    try {
      await on(a, () => advanceJob(created.jobId));
      const current = await state(created.id);
      expect(current.transactions).toHaveLength(0);
      expect(current.row).toMatchObject({
        next_chunk: 0,
        status: 'queued',
        inserted_count: 0,
        rejected_count: 0,
      });
      expect(JSON.parse(current.jobs[0]!.cursor).nextChunk).toBeUndefined();
      expect(current.jobs[0]?.error).toMatch(/cursor was not advanced/);
    } finally {
      await owner.unsafe(
        'DROP TRIGGER reject_finance_cursor ON fin_statement_imports; DROP FUNCTION reject_finance_cursor()',
      );
    }
    const retry = await on(b, () => retryImport(scope(), created.id));
    expect(retry).toMatchObject({ status: 'queued', nextChunk: 0, insertedCount: 0 });
    await idleJobs(created.id);
    expect((await state(created.id)).row).toMatchObject({
      status: 'done',
      inserted_count: 2,
      rejected_count: 1,
    });
  });

  it('a committed chunk survives lost handler response and duplicate restart without another insert', async () => {
    const created = await seed();
    registerJobHandler({
      type: STATEMENT_JOB_TYPE,
      advance: async (job, execution) => {
        await originalHandler.advance(job, execution);
        throw new Error('synthetic lost handler response');
      },
    });
    await on(a, () => advanceJob(created.jobId));
    const committed = await state(created.id);
    expect(committed.row.status).toBe('done');
    expect(committed.jobs[0]?.status).toBe('failed');
    expect(JSON.parse(committed.jobs[0]!.cursor).nextChunk).toBe(3);
    registerJobHandler(originalHandler);
    const resumed = await duplicate(created);
    await on(b, () => advanceJob(resumed));
    expect((await state(created.id)).transactions).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts partial duplicate rows from actual inserts and preserves parser rejection semantics', async () => {
    const created = await seed();
    const first = parseStatementCsv(CSV).entries.find((entry) => entry.ok)!;
    if (!first.ok) throw new Error('Fixture parser did not accept first row');
    await owner`insert into fin_transactions(org_id,import_id,source_row,posted_on,description,signed_amount)
      values(${ORG},${created.id},${first.sourceRow},${first.postedOn},${first.description},${first.signedAmount})`;
    await owner`update fin_statement_imports set inserted_count=1 where id=${created.id}`;
    await on(a, () => advanceJob(created.jobId));
    const current = await state(created.id);
    expect(current.row).toMatchObject({ inserted_count: 2, rejected_count: 1, next_chunk: 3 });
    expect(current.transactions).toHaveLength(2);
  });

  it.each(['queued', 'parsing'])(
    'rejects legacy %s work and explicitly retries without deleting committed progress',
    async (status) => {
      const created = await seed(CSV, status, 1);
      await owner`delete from job_effects where entity_id=${created.id}`;
      await owner`update bg_jobs set cursor=null where id=${created.jobId}`;
      await owner`insert into fin_transactions(org_id,import_id,source_row,posted_on,description,signed_amount)
      values(${ORG},${created.id},2,'2026-01-05','Grocery',-45.90)`;
      await owner`update fin_statement_imports set inserted_count=1 where id=${created.id}`;
      await on(a, () => advanceJob(created.jobId));
      expect(fetch).not.toHaveBeenCalled();
      expect((await state(created.id)).jobs[0]?.error).toMatch(/Unversioned statement job/);
      const result = await on(b, () => retryImport(scope(), created.id));
      expect(result).toMatchObject({ nextChunk: 1, insertedCount: 1, status: 'queued' });
      await idleJobs(created.id);
      const current = await state(created.id);
      expect(current.row).toMatchObject({
        status: 'done',
        next_chunk: 3,
        inserted_count: 2,
        rejected_count: 1,
      });
      expect(current.transactions).toHaveLength(2);
    },
  );

  it('persists a 500-row chunk with job progress and rejects parsing undo before explicit retry resumes', async () => {
    const text = [
      'Date,Description,Amount',
      ...Array.from({ length: 501 }, (_, i) => `2026-01-05,Row${i},1.00`),
    ].join('\n');
    const created = await seed(text),
      second = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(text))
      .mockImplementationOnce(() => second.promise);
    const old = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 2);
    const partial = await state(created.id);
    expect(partial.row).toMatchObject({ next_chunk: 500, inserted_count: 500, status: 'parsing' });
    expect(JSON.parse(partial.jobs[0]!.cursor).nextChunk).toBe(500);
    await expect(on(b, () => undoImport(scope(), created.id))).rejects.toMatchObject({
      status: 409,
    });
    const retry = await on(b, () => retryImport(scope(), created.id));
    expect(retry).toMatchObject({ nextChunk: 500, insertedCount: 500 });
    await until(async () => (await state(created.id)).row.status === 'done');
    second.resolve(new Response(text));
    await old;
    expect((await state(created.id)).transactions).toHaveLength(501);
  });

  it('RLS denies cross-org reads, parent references and writes without role leakage', async () => {
    const created = await seed();
    expect(await on(b, () => getImportStatus(scope(OTHER), created.id))).toBeNull();
    expect(await on(b, () => retryImport(scope(OTHER), created.id))).toBeNull();
    expect(await on(b, () => undoImport(scope(OTHER), created.id))).toBeNull();
    await expect(
      on(b, () =>
        withOrgCore(scope(OTHER), (tx) =>
          tx.execute(sql`
      insert into fin_transactions(org_id,import_id,source_row,posted_on,description,signed_amount)
      values(${OTHER},${created.id},1,'2026-01-01','forbidden',1)`),
        ),
      ),
    ).rejects.toBeDefined();
    await expect(
      on(b, () =>
        withOrgCore(scope(), (tx) => tx.update(finStatementImports).set({ orgId: OTHER })),
      ),
    ).rejects.toBeDefined();
    await on(a, () => advanceJob(created.jobId));
    const [session] =
      await b`select current_user as role,current_setting('app.current_org_id',true) as org,
      current_setting('app.current_profile_id',true) as profile`;
    expect(session?.role).toBe('minion_qc');
    expect(session?.org || '').toBe('');
    expect(session?.profile || '').toBe('');
    expect((await state(created.id)).row.status).toBe('done');
  });

  it('concurrent explicit retries retain only the last revision authority', async () => {
    const created = await seed(),
      blocked = deferred<Response>();
    vi.mocked(fetch).mockImplementation(async () => {
      await blocked.promise;
      return new Response(CSV);
    });
    await Promise.all([
      on(a, () => retryImport(scope(), created.id)),
      on(b, () => retryImport(scope(), created.id)),
    ]);
    await until(() => vi.mocked(fetch).mock.calls.length >= 1);
    const before = await state(created.id);
    expect(before.jobs).toHaveLength(3);
    expect(before.head?.revision).not.toBe(created.request.revision);
    blocked.resolve(new Response(CSV));
    await on(a, () => advanceJob(created.jobId));
    await idleJobs(created.id);
    const current = await state(created.id);
    expect(current.transactions).toHaveLength(2);
    expect(current.jobs.filter((job) => job.status === 'done')).toHaveLength(1);
    expect(
      readJobRequest({ cursor: current.jobs.find((job) => job.status === 'done')!.cursor })
        ?.revision,
    ).toBe(current.head?.revision);
  });

  it('a retry waiting on the head cannot reset an import that completed after its pre-read', async () => {
    const created = await seed(),
      locked = deferred<void>(),
      release = deferred<void>();
    const completion = owner.begin(async (tx) => {
      await tx`select id from job_effects where entity_id=${created.id} for update`;
      locked.resolve();
      await release.promise;
      await tx`update fin_statement_imports set status='done',next_chunk=3 where id=${created.id}`;
    });
    await locked.promise;
    const retry = on(b, () => retryImport(scope(), created.id));
    await until(
      async () =>
        (
          await a`select pid from pg_stat_activity where pid=${backendIds[1]!} and wait_event_type='Lock'`
        ).length === 1,
    );
    release.resolve();
    await completion;
    expect(await retry).toMatchObject({ status: 'done', nextChunk: 3 });
    const current = await state(created.id);
    expect(current.jobs).toHaveLength(1);
    expect(current.head?.revision).toBe(created.request.revision);
    await on(a, () => advanceJob(created.jobId));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('failed content can be retried after storage recovery without resetting existing rows', async () => {
    const created = await seed();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('corrupted content'));
    await on(a, () => advanceJob(created.jobId));
    expect((await state(created.id)).row).toMatchObject({ status: 'failed', next_chunk: 0 });
    await on(b, () => retryImport(scope(), created.id));
    await idleJobs(created.id);
    const current = await state(created.id);
    expect(current.row).toMatchObject({
      status: 'done',
      inserted_count: 2,
      rejected_count: 1,
      error_code: null,
    });
    expect(current.transactions).toHaveLength(2);
  });
});
