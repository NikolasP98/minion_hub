import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn(), usage: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('$server/ai-usage', () => ({ recordAiUsage: boundary.usage }));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'synthetic' } }));
import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCoreTransaction, type CoreTx, type OrgScope } from '$server/db/with-org-core';
import {
  advanceJob,
  enqueueJob,
  registerJobHandler,
  type BgJob,
  type JobExecution,
} from './bg-runtime';
import {
  createJobRequest,
  revokeJobRequest,
  readJobRequest,
  withJobRequest,
  runJobEmbedding,
  commitJobEffects,
  bindLegacyJobRequest,
  bindSourceJobRequest,
  type JobRequest,
  jobRequestAdvanceResult,
  bindJobManifest,
} from './job-effects.service';

type Client = ReturnType<typeof postgres>;
const context = new AsyncLocalStorage<Client>();
const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client, a: Client, b: Client;
const ORG = 'qc-org-a',
  OTHER = 'qc-org-b';
const identity = { family: 'brain.canonical', entityId: 'document' };
const sourceHash = createHash('sha256').update('synthetic document').digest('hex');
const manifestHash = 'c'.repeat(64);
const expectedProvider = {
  endpoint: 'https://openrouter.ai/api/v1/embeddings',
  model: 'openai/text-embedding-3-small',
  normalization: 'embedding-text-v1',
  dimensions: 1536,
};
const manifestOptions = { expectedManifestHash: manifestHash, expectedProvider };
async function validateDocument(tx: CoreTx, job: BgJob, expected = sourceHash) {
  const [document] = await tx.execute<{ source_hash: string }>(sql`select source_hash from documents
    where tenant_id=${job.tenantId} and id=${identity.entityId} for update`);
  if (job.refId !== identity.entityId || document?.source_hash !== expected)
    throw new Error('Domain request does not correspond to this job/source');
}
const operations = new Map<string, (job: BgJob, execution: JobExecution) => Promise<void>>();
const errors = new Map<string, unknown>();
const outstanding = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
const on = <T>(client: Client, fn: () => Promise<T>) => {
  const promise = context.run(client, fn);
  outstanding.add(promise);
  void promise.then(
    () => outstanding.delete(promise),
    () => outstanding.delete(promise),
  );
  return promise;
};
const scope = (tenantId = ORG): OrgScope => ({ tenantId, db: getCoreDb() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  releases.add(() => resolve(undefined as T));
  return { promise, resolve };
}
async function until(test: () => boolean | Promise<boolean>) {
  const end = Date.now() + 4000;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('Fixture failed to reach required boundary');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const vector = Array(1536).fill(0.25) as number[];
const response = () =>
  Response.json({ data: [{ index: 0, embedding: vector }], usage: { prompt_tokens: 3 } });
async function newRequest(client = a, hash = sourceHash) {
  return on(client, () =>
    createJobRequest(scope(), identity, hash, { type: 'qc_effect' }, async (tx) => {
      await tx.execute(sql`insert into documents (tenant_id, id, source_hash, published) values (${ORG}, ${identity.entityId}, ${hash}, 0)
      on conflict (tenant_id,id) do update set source_hash=excluded.source_hash`);
    }),
  );
}
async function step(
  id: string,
  work: (job: BgJob, execution: JobExecution) => Promise<void>,
  client = a,
) {
  // A previous bounded callback has settled; simulate its lease expiring before
  // the next real runtime claim. Concurrent scenarios explicitly control loss.
  await owner`update bg_jobs set lease_until=0 where id=${id} and status='running'`;
  operations.set(id, work);
  return on(client, () => advanceJob(id, 100));
}
async function publish(execution: JobExecution, request: JobRequest, next = 1) {
  return commitJobEffects(
    execution,
    scope(),
    request,
    ['batch'],
    async (tx) => {
      await tx.execute(
        sql`update documents set published=published+1 where tenant_id=${ORG} and id=${identity.entityId}`,
      );
      return 'published';
    },
    { next },
  );
}
async function rows(table: 'job_effects' | 'documents') {
  return owner.unsafe(`select * from ${table} order by id`);
}

beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
    CREATE TABLE bg_jobs (id text primary key, tenant_id text not null, user_id text, type text not null,
      ref_id text, status text not null default 'queued', cursor text, error text, attempts integer not null default 0,
      lease_until bigint, created_at bigint not null, updated_at bigint not null, started_at bigint, finished_at bigint);
    CREATE TABLE documents (tenant_id text not null, id text not null, source_hash text not null,
      published integer not null default 0, primary key(tenant_id,id));`);
  for (const file of [
    '20260909090100_bg_job_lease_generation.sql',
    '20260909090300_job_effect_receipts.sql',
    '20260909090400_job_request_manifest.sql',
  ]) {
    const ddl = readFileSync(
      new URL(`../../../supabase/migrations/${file}`, import.meta.url),
      'utf8',
    );
    if (file === '20260909090400_job_request_manifest.sql') {
      const descriptor = {
        ...expectedProvider,
        payloadHash: 'f'.repeat(64),
        count: 1,
        pipelineVersion: 'v1',
      };
      const result = [Array(1536).fill(0.25)];
      await owner`insert into job_effects(id,tenant_id,family,entity_id,kind,revision,unit,source_hash,state,descriptor,result)
        values(${'e'.repeat(64)},${ORG},'upgrade','document','effect','00000000-0000-4000-8000-000000000001',
          'batch',${sourceHash},'received',${owner.json(descriptor)},${owner.json(result)})`;
      await owner`insert into job_effects(id,tenant_id,family,entity_id,kind,revision,unit,source_hash,state)
        values(${'a'.repeat(64)},${ORG},'upgrade','document','head','00000000-0000-4000-8000-000000000001','',${sourceHash},'active')`;
      const before = await owner`select * from job_effects where family='upgrade' order by id`;
      await owner.unsafe(ddl.replaceAll('public.', `"${schema}".`));
      const after = await owner`select * from job_effects where family='upgrade' order by id`;
      expect(after.every((row) => row.manifest_hash === null)).toBe(true);
      const preserved = after.map(({ manifest_hash: _manifest, ...row }) => row);
      expect(preserved).toEqual([...before]);
    } else await owner.unsafe(ddl.replaceAll('public.', `"${schema}".`));
  }
  await owner.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;
    GRANT SELECT,INSERT,UPDATE,DELETE ON documents TO app_ledger;
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE documents FORCE ROW LEVEL SECURITY;
    CREATE POLICY documents_org ON documents TO app_ledger
      USING (tenant_id=current_setting('app.current_org_id',true))
      WITH CHECK (tenant_id=current_setting('app.current_org_id',true));`);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  const identities = await Promise.all(
    [a, b].map(async (client) => {
      const [identity] =
        await client`select pg_backend_pid() as pid, current_database() as database,
      shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`;
      return identity;
    }),
  );
  for (const identity of identities) {
    expect(identity).toMatchObject({
      database: harness.identity.database,
      marker: harness.identity.marker,
    });
    expect(Number.isInteger(identity?.pid)).toBe(true);
  }
  expect(identities[0]?.pid).not.toBe(identities[1]?.pid);
  owner = harness.createConnection(schema);
  boundary.pool.mockImplementation(() => context.getStore() ?? a);
  registerJobHandler({
    type: 'qc_effect',
    advance: async (job, execution) => {
      try {
        const work = operations.get(job.id);
        if (!work) throw new Error('Missing fixture operation');
        await work(job, execution);
        const [current] = await owner`select cursor from bg_jobs where id=${job.id}`;
        const request = readJobRequest({ cursor: current!.cursor });
        if (!request) throw new Error('Fixture handler did not bind its request');
        const result = await jobRequestAdvanceResult(execution, scope(), request);
        // Finish this bounded callback after admission budget; do not repeatedly
        // invoke its fixture work within one advanceJob call.
        await new Promise((resolve) => setTimeout(resolve, 120));
        return result;
      } catch (error) {
        errors.set(job.id, error);
        throw error;
      }
    },
  });
}, 20000);

beforeEach(async () => {
  errors.clear();
  operations.clear();
  boundary.usage.mockClear();
  await owner.unsafe('TRUNCATE bg_jobs,job_effects,documents');
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async () => response()),
  );
});
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...outstanding]);
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (owner) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness?.close();
});

describe('native job receipt ownership', () => {
  it('binds one shared manifest across duplicate jobs and rejects incompatible progress', async () => {
    const created = await newRequest();
    const duplicate = await on(b, () =>
      enqueueJob({
        tenantId: ORG,
        type: 'qc_effect',
        refId: identity.entityId,
        cursor: { __jobRequest: created.request },
      }),
    );
    await Promise.all(
      [a, b].map((client, index) =>
        step(
          index ? duplicate : created.jobId,
          async (_job, execution) =>
            bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument, {
              prepared: true,
            }),
          client,
        ),
      ),
    );
    expect(errors.size).toBe(0);
    expect((await rows('job_effects'))[0]?.manifest_hash).toBe(manifestHash);
    await step(created.jobId, async (_job, execution) => {
      await expect(
        bindJobManifest(execution, scope(), created.request, 'd'.repeat(64), validateDocument),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        withJobRequest(
          execution,
          scope(),
          created.request,
          async () => null,
          { changed: true },
          'd'.repeat(64),
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
      await withJobRequest(
        execution,
        scope(),
        created.request,
        async () => null,
        undefined,
        manifestHash,
      );
    });
    expect(errors.size).toBe(0);
    const [job] = await owner`select cursor from bg_jobs where id=${created.jobId}`;
    expect(JSON.parse(job!.cursor).prepared).toBe(true);
    expect(JSON.parse(job!.cursor).changed).toBeUndefined();
  });

  it.each(['admitted', 'received', 'committed'])(
    'rejects binding null manifest with existing %s effects',
    async (state) => {
      const created = await newRequest();
      await step(created.jobId, async (_job, execution) => {
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      });
      if (state === 'admitted')
        await owner`update job_effects set state='admitted',result=null where kind='effect'`;
      if (state === 'committed')
        await owner`update job_effects set state='committed' where kind='effect'`;
      await step(created.jobId, async (_job, execution) => {
        await expect(
          bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument),
        ).rejects.toMatchObject({ code: 'conflict' });
      });
      expect(errors.size).toBe(0);
      expect(
        (await rows('job_effects')).find((row) => row.kind === 'head')?.manifest_hash,
      ).toBeNull();
      expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(state);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('requires manifest assertions on bound effect admission, replay and commit', async () => {
    const created = await newRequest();
    await step(created.jobId, async (_job, execution) => {
      await bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument);
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await runJobEmbedding(
        execution,
        scope(),
        created.request,
        'batch',
        ['content'],
        'v1',
        manifestOptions,
      );
      await expect(publish(execution, created.request)).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1', {
          ...manifestOptions,
          expectedManifestHash: 'd'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
      const callerRequest = { ...created.request };
      const intercepted: JobExecution = {
        ...execution,
        withOwnership: (operation) =>
          execution.withOwnership((tx, current) => {
            callerRequest.entityId = 'mutated-after-call';
            return operation(tx, current);
          }),
      };
      await commitJobEffects(
        intercepted,
        scope(),
        callerRequest,
        ['batch'],
        async (tx) => {
          await tx.execute(sql`update documents set published=published+1`);
        },
        { next: 1 },
        manifestHash,
      );
    });
    expect(errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await rows('documents'))[0]?.published).toBe(1);
  });

  it('preserves the local completed guard exception without binding, admission or progress', async () => {
    const created = await newRequest(),
      complete = new Error('local completed');
    const guard = async () => {
      throw complete;
    };
    await step(created.jobId, async (_job, execution) => {
      await expect(
        bindJobManifest(execution, scope(), created.request, manifestHash, guard, {
          forbidden: true,
        }),
      ).rejects.toBe(complete);
      expect((await rows('job_effects'))[0]?.manifest_hash).toBeNull();
      await bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument);
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1', {
          ...manifestOptions,
          validateDomain: guard,
        }),
      ).rejects.toBe(complete);
    });
    expect(errors.size).toBe(0);
    expect(await rows('job_effects')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks ready inside the locked missing-admission transaction but preserves existing indeterminacy', async () => {
    const created = await newRequest(),
      locked = deferred<void>(),
      release = deferred<void>();
    await step(created.jobId, async (_job, execution) =>
      bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument),
    );
    const completed = new Error('local ready');
    const guard = async (tx: CoreTx) => {
      const [row] = await tx.execute<{ published: number }>(
        sql`select published from documents for update`,
      );
      if (row?.published) throw completed;
    };
    const publishFirst = on(b, async () =>
      b.begin(async (tx) => {
        await tx`select id from job_effects where kind='head' for update`;
        await tx`update documents set published=1`;
        locked.resolve();
        await release.promise;
      }),
    );
    await locked.promise;
    const admission = step(created.jobId, async (_job, execution) => {
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1', {
          ...manifestOptions,
          validateDomain: guard,
        }),
      ).rejects.toBe(completed);
    });
    await until(
      async () =>
        (
          await owner`select pid from pg_stat_activity
      where wait_event_type='Lock' and datname=current_database()`
        ).length > 0,
    );
    release.resolve();
    await publishFirst;
    await admission;
    expect(errors.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    await owner`update documents set published=0`;
    await step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(
        execution,
        scope(),
        created.request,
        'batch',
        ['content'],
        'v1',
        manifestOptions,
      );
    });
    await owner`update documents set published=1`;
    const spy = vi.fn(guard);
    await step(created.jobId, async (_job, execution) => {
      expect(
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1', {
          ...manifestOptions,
          validateDomain: spy,
        }),
      ).toEqual([vector]);
    });
    expect(spy).not.toHaveBeenCalled();
    await owner`update job_effects set state='admitted',result=null where kind='effect'`;
    await step(created.jobId, async (_job, execution) => {
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1', {
          ...manifestOptions,
          validateDomain: spy,
        }),
      ).rejects.toMatchObject({ code: 'indeterminate' });
    });
    expect(spy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves pinned provider/body after preparation and snapshots the caller contract', async () => {
    const created = await newRequest();
    const { env } = await import('$env/dynamic/private');
    await step(created.jobId, async (_job, execution) => {
      await bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument);
      const options = {
        expectedManifestHash: manifestHash,
        expectedProvider: { ...expectedProvider },
        validateDomain: async () => {
          env.OPENROUTER_API_KEY = '';
          env.OPENAI_API_KEY = 'synthetic-direct';
          options.expectedProvider.model = 'mutated';
          options.expectedManifestHash = 'd'.repeat(64);
        },
      };
      try {
        await runJobEmbedding(
          execution,
          scope(),
          created.request,
          'batch',
          ['content'],
          'v1',
          options,
        );
        const [url, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(url).toBe(expectedProvider.endpoint);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: expectedProvider.model,
          input: ['content'],
        });
        await expect(
          runJobEmbedding(
            execution,
            scope(),
            created.request,
            'later',
            ['later'],
            'v1',
            manifestOptions,
          ),
        ).rejects.toMatchObject({ code: 'conflict' });
      } finally {
        env.OPENROUTER_API_KEY = 'synthetic';
        delete env.OPENAI_API_KEY;
      }
    });
    expect(errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
      'received',
    );
  });

  it('reasserts manifest when a late provider response returns', async () => {
    const created = await newRequest(),
      blocked = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => blocked.promise);
    const running = step(created.jobId, async (_job, execution) => {
      await bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument);
      await runJobEmbedding(
        execution,
        scope(),
        created.request,
        'batch',
        ['content'],
        'v1',
        manifestOptions,
      );
    });
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await owner`update job_effects set manifest_hash=${'d'.repeat(64)} where kind='head'`;
    blocked.resolve(response());
    await running;
    expect(errors.get(created.jobId)).toMatchObject({ code: 'conflict' });
    expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
      'admitted',
    );
  });

  it('clears manifests on create, revoke and source-change revisions without deleting receipts', async () => {
    const created = await newRequest();
    await step(created.jobId, async (_job, execution) => {
      await bindJobManifest(execution, scope(), created.request, manifestHash, validateDocument);
      await runJobEmbedding(
        execution,
        scope(),
        created.request,
        'batch',
        ['content'],
        'v1',
        manifestOptions,
      );
    });
    const next = await newRequest(b);
    expect(
      (await rows('job_effects')).find((row) => row.kind === 'head')?.manifest_hash,
    ).toBeNull();
    expect((await rows('job_effects')).filter((row) => row.kind === 'effect')).toHaveLength(1);
    await step(next.jobId, async (_job, execution) =>
      bindJobManifest(execution, scope(), next.request, manifestHash, validateDocument),
    );
    await on(b, () => revokeJobRequest(scope(), identity, async () => {}));
    expect(
      (await rows('job_effects')).find((row) => row.kind === 'head')?.manifest_hash,
    ).toBeNull();
    const fresh = await newRequest();
    await step(fresh.jobId, async (_job, execution) => {
      await bindJobManifest(execution, scope(), fresh.request, manifestHash, validateDocument);
      await owner`update documents set source_hash=${'b'.repeat(64)}`;
      await bindSourceJobRequest(execution, scope(), identity, 'b'.repeat(64), (tx, current) =>
        validateDocument(tx, current, 'b'.repeat(64)),
      );
    });
    expect(errors.size).toBe(0);
    expect(
      (await rows('job_effects')).find((row) => row.kind === 'head')?.manifest_hash,
    ).toBeNull();
    expect((await rows('job_effects')).filter((row) => row.kind === 'effect')).toHaveLength(1);
  });

  it('the additive migration rejects malformed manifests and partial reapplication', async () => {
    const created = await newRequest();
    for (const value of ['bad', 'A'.repeat(64), 'a'.repeat(65)])
      await expect(
        owner`update job_effects set manifest_hash=${value} where kind='head'`,
      ).rejects.toBeDefined();
    await step(created.jobId, async (_job, execution) =>
      runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1').then(
        () => {},
      ),
    );
    await expect(
      owner`update job_effects set manifest_hash=${manifestHash} where kind='effect'`,
    ).rejects.toBeDefined();
    const ddl = readFileSync(
      new URL(
        '../../../supabase/migrations/20260909090400_job_request_manifest.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await expect(owner.unsafe(ddl.replaceAll('public.', `"${schema}".`))).rejects.toBeDefined();
    await expect(
      owner.begin(async (tx) => {
        await tx.unsafe('ALTER TABLE job_effects DROP CONSTRAINT job_effects_manifest_shape');
        await expect(tx.unsafe(ddl.replaceAll('public.', `"${schema}".`))).rejects.toBeDefined();
        throw new Error('rollback deliberate partial catalog');
      }),
    ).rejects.toThrow('rollback deliberate partial catalog');
    expect(
      await owner`select conname from pg_constraint where conrelid=${`${schema}.job_effects`}::regclass
      and conname='job_effects_manifest_shape'`,
    ).toHaveLength(1);
    expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
      'received',
    );
  });
  it('reuses a received batch after restart and atomically publishes only once', async () => {
    const created = await newRequest();
    await step(created.jobId, async (job, execution) => {
      expect(readJobRequest(job)).toEqual(created.request);
      expect(
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1'),
      ).toEqual([vector]);
    });
    expect(errors.size).toBe(0);
    await step(created.jobId, async (_job, execution) => {
      expect(
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1'),
      ).toEqual([vector]);
      expect(await publish(execution, created.request)).toEqual({
        replayed: false,
        value: 'published',
      });
      const replay = await publish(execution, created.request, 999);
      expect(replay.replayed).toBe(true);
    });
    expect(errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await rows('documents'))[0]?.published).toBe(1);
    const [job] = await owner`select cursor from bg_jobs where id=${created.jobId}`;
    expect(JSON.parse(job!.cursor).next).toBe(1);
    expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
      'committed',
    );
  });

  it('duplicate jobs share admission while one request is in flight', async () => {
    const created = await newRequest();
    const duplicate = await on(b, () =>
      enqueueJob({
        tenantId: ORG,
        type: 'qc_effect',
        refId: identity.entityId,
        cursor: { __jobRequest: created.request },
      }),
    );
    const blocked = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => blocked.promise);
    const first = step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      await publish(execution, created.request);
    });
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await step(
      duplicate,
      async (_job, execution) => {
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      },
      b,
    );
    expect(errors.get(duplicate)).toMatchObject({ code: 'indeterminate' });
    blocked.resolve(response());
    await first;
    expect(errors.has(created.jobId)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await rows('documents'))[0]?.published).toBe(1);
  });

  it('retains indeterminate admission after response loss and does not replay remotely', async () => {
    const created = await newRequest();
    vi.mocked(fetch).mockRejectedValue(new TypeError('synthetic lost response'));
    await step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
    });
    const duplicate = await on(b, () =>
      enqueueJob({ tenantId: ORG, type: 'qc_effect', cursor: { __jobRequest: created.request } }),
    );
    await step(
      duplicate,
      async (_job, execution) => {
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      },
      b,
    );
    expect(errors.get(duplicate)).toMatchObject({ code: 'indeterminate' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
      'admitted',
    );
  });

  it.each(['cancel', 'takeover', 'reset'])(
    'rejects a late provider response after %s',
    async (mode) => {
      const created = await newRequest();
      const blocked = deferred<Response>();
      vi.mocked(fetch).mockImplementation(() => blocked.promise);
      const running = step(created.jobId, async (_job, execution) => {
        await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
        await publish(execution, created.request);
      });
      await until(() => vi.mocked(fetch).mock.calls.length === 1);
      if (mode === 'cancel')
        await owner`update bg_jobs set status='cancelled' where id=${created.jobId}`;
      if (mode === 'takeover')
        await owner`update bg_jobs set lease_generation=lease_generation+1 where id=${created.jobId}`;
      if (mode === 'reset') await newRequest(b, 'b'.repeat(64));
      blocked.resolve(response());
      await running;
      expect(errors.get(created.jobId)).toMatchObject({
        code: mode === 'reset' ? 'superseded' : 'ownership_lost',
      });
      expect((await rows('documents'))[0]?.published).toBe(0);
      expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
        'admitted',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rolls back publication, receipt completion and progress together', async () => {
    const created = await newRequest();
    await step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      await expect(
        commitJobEffects(
          execution,
          scope(),
          created.request,
          ['batch'],
          async (tx) => {
            await tx.execute(sql`update documents set published=99`);
            throw new Error('synthetic publication failure');
          },
          { next: 1 },
        ),
      ).rejects.toThrow('synthetic publication failure');
      expect((await rows('documents'))[0]?.published).toBe(0);
      expect((await rows('job_effects')).find((row) => row.kind === 'effect')?.state).toBe(
        'received',
      );
      await publish(execution, created.request);
    });
    expect(errors.size).toBe(0);
    expect((await rows('documents'))[0]?.published).toBe(1);
  });

  it('rejects a changed payload/configuration for an existing unit', async () => {
    const created = await newRequest();
    await step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['different'], 'v1'),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v2'),
      ).rejects.toMatchObject({ code: 'conflict' });
    });
    expect(errors.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('legacy adoption validates domain state once and refuses a later explicit request', async () => {
    await owner`insert into documents(tenant_id,id,source_hash) values(${ORG},${identity.entityId},${sourceHash})`;
    const legacy = await on(a, () =>
      enqueueJob({ tenantId: ORG, type: 'qc_effect', refId: identity.entityId }),
    );
    await step(legacy, async (_job, execution) => {
      const request = await bindLegacyJobRequest(
        execution,
        scope(),
        identity,
        sourceHash,
        validateDocument,
      );
      expect(request.sourceHash).toBe(sourceHash);
    });
    expect(errors.size).toBe(0);
    await newRequest(b);
    const old = await on(a, () =>
      enqueueJob({ tenantId: ORG, type: 'qc_effect', refId: identity.entityId }),
    );
    await step(old, async (_job, execution) => {
      await bindLegacyJobRequest(execution, scope(), identity, sourceHash, validateDocument);
    });
    expect(errors.get(old)).toMatchObject({ code: 'conflict' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('source jobs share semantic revisions and revoke old work after a changed source', async () => {
    await owner`insert into documents(tenant_id,id,source_hash) values(${ORG},${identity.entityId},${sourceHash})`;
    const ids = await Promise.all(
      [a, b].map((client) =>
        on(client, () =>
          enqueueJob({ tenantId: ORG, type: 'qc_effect', refId: identity.entityId }),
        ),
      ),
    );
    const requests: JobRequest[] = [];
    for (const id of ids)
      await step(id, async (_job, execution) => {
        requests.push(
          await bindSourceJobRequest(execution, scope(), identity, sourceHash, validateDocument),
        );
      });
    expect(requests[0]).toEqual(requests[1]);
    await owner`update documents set source_hash=${'b'.repeat(64)}`;
    await step(ids[1]!, async (_job, execution) => {
      const changed = await bindSourceJobRequest(
        execution,
        scope(),
        identity,
        'b'.repeat(64),
        (tx, current) => validateDocument(tx, current, 'b'.repeat(64)),
      );
      expect(changed.revision).not.toBe(requests[0]!.revision);
    });
    await step(ids[0]!, async (_job, execution) => {
      await withJobRequest(execution, scope(), requests[0]!, async () => null);
    });
    expect(errors.get(ids[0]!)).toMatchObject({ code: 'superseded' });
  });

  it('revocation plus domain deletion is atomic and stops old progress', async () => {
    const created = await newRequest();
    await on(b, () =>
      revokeJobRequest(scope(), identity, (tx) => tx.execute(sql`delete from documents`)),
    );
    await step(created.jobId, async (_job, execution) => {
      await withJobRequest(execution, scope(), created.request, async () => null, { next: 2 });
    });
    expect(errors.get(created.jobId)).toMatchObject({ code: 'superseded' });
    expect(await rows('documents')).toHaveLength(0);
  });

  it('RLS denies cross-org receipts and cannot update bg_jobs; scope is restored for bookkeeping', async () => {
    const created = await newRequest();
    await on(a, () =>
      getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
        await withOrgCoreTransaction(scope(OTHER), tx, async (domain) => {
          expect(await domain.execute(sql`select * from job_effects`)).toHaveLength(0);
        });
        await withOrgCoreTransaction(
          { ...scope(), profileId: 'synthetic-actor' },
          tx,
          async (domain) => {
            expect(await domain.execute(sql`select * from job_effects`)).toHaveLength(1);
            const [inside] = await domain.execute<{ profile: string }>(
              sql`select current_setting('app.current_profile_id',true) as profile`,
            );
            expect(inside?.profile).toBe('synthetic-actor');
          },
        );
        await tx.execute(sql`update bg_jobs set cursor=cursor where id=${created.jobId}`);
      }),
    );
    await expect(
      on(a, () =>
        getOrgTransactionDb(getCoreDb()).transaction((tx) =>
          withOrgCoreTransaction(scope(), tx, (domain) =>
            domain.execute(sql`update bg_jobs set cursor=null`),
          ),
        ),
      ),
    ).rejects.toBeDefined();
    for (const command of [
      sql`update job_effects set tenant_id=${OTHER}`,
      sql`insert into job_effects select repeat('b',64),${OTHER},family,entity_id,kind,revision,unit,source_hash,state,descriptor,result,legacy_job_id,created_at,updated_at from job_effects`,
    ])
      await expect(
        on(a, () =>
          getOrgTransactionDb(getCoreDb()).transaction((tx) =>
            withOrgCoreTransaction(scope(), tx, (domain) => domain.execute(command)),
          ),
        ),
      ).rejects.toBeDefined();
    const [state] =
      await a`select current_user as role, current_setting('app.current_org_id',true) as org,
      current_setting('app.current_profile_id',true) as profile`;
    expect(state?.role).toBe('minion_qc');
    expect(state?.org || '').toBe('');
    expect(state?.profile || '').toBe('');
  });

  it('restores scope after an application error and preserves the original SQL error', async () => {
    await on(a, () =>
      getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
        await expect(
          withOrgCoreTransaction(scope(), tx, async () => {
            throw new Error('application');
          }),
        ).rejects.toThrow('application');
        const [state] = await tx.execute<{ role: string }>(sql`select current_user as role`);
        expect(state?.role).toBe('minion_qc');
      }),
    );
    let original: unknown;
    const failure = await on(a, () =>
      getOrgTransactionDb(getCoreDb()).transaction((tx) =>
        withOrgCoreTransaction(scope(), tx, async (domain) => {
          try {
            await domain.execute(sql`select 1/0`);
          } catch (error) {
            original = error;
            throw error;
          }
        }),
      ),
    ).catch((error: unknown) => error);
    expect(failure).toBe(original);
    expect((await a`select 1 as healthy`)[0]?.healthy).toBe(1);
  });

  it('the authored migration rejects partial schemas and malformed persisted receipts', async () => {
    const [catalog] = await owner`select relrowsecurity,relforcerowsecurity from pg_class
      where oid=${`${schema}.job_effects`}::regclass`;
    expect(catalog).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const [grants] = await owner`select
      has_table_privilege('app_ledger',${`${schema}.job_effects`},'DELETE') as receipt_delete,
      has_table_privilege('app_ledger',${`${schema}.bg_jobs`},'UPDATE') as job_update`;
    expect(grants).toMatchObject({ receipt_delete: false, job_update: false });
    const ddl = readFileSync(
      new URL(
        '../../../supabase/migrations/20260909090300_job_effect_receipts.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await expect(owner.unsafe(ddl.replaceAll('public.', `"${schema}".`))).rejects.toBeDefined();
    const created = await newRequest();
    await step(created.jobId, async (_job, execution) => {
      await runJobEmbedding(execution, scope(), created.request, 'batch', ['content'], 'v1');
    });
    await expect(
      owner`update job_effects set descriptor=descriptor || '{"count":null}'::jsonb where kind='effect'`,
    ).rejects.toBeDefined();
    await expect(
      owner`update job_effects set descriptor=descriptor || '{"count":"1"}'::jsonb where kind='effect'`,
    ).rejects.toBeDefined();
    await expect(
      owner`update job_effects set result='[[1]]'::jsonb where kind='effect'`,
    ).rejects.toBeDefined();
    await expect(
      owner`update job_effects set state='received' where kind='head'`,
    ).rejects.toBeDefined();
    expect(errors.size).toBe(0);
  });
});
