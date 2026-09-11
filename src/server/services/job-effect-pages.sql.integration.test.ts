import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { jobEffectBatches, jobEffectUnits } from '$server/db/pg-schema/job-effect-pages';
import { PgDialect } from 'drizzle-orm/pg-core';
import { prepareEmbeddingRequest } from './embeddings';
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
const boundary = vi.hoisted(() => ({
  pool: vi.fn(),
  usage: vi.fn(),
  env: {
    OPENROUTER_API_KEY: 'synthetic-page-fixture' as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
  },
}));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('$server/ai-usage', () => ({ recordAiUsage: boundary.usage }));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
import { getCoreDb } from '$server/db/pg-client';
import type { CoreTx, OrgScope } from '$server/db/with-org-core';
import {
  advanceJob,
  enqueueJob,
  registerJobHandler,
  type BgJob,
  type JobExecution,
} from './bg-runtime';
import {
  createJobRequest,
  withOwnedJobScope,
  jobEffectHeadId,
  runJobEmbedding,
} from './job-effects.service';
import {
  bindJobEffectPage,
  loadJobEffectPage,
  runJobPageEmbeddings,
  commitJobEffectPage,
  jobEffectPageAdvanceResult,
  withJobEffectPage,
  type PageInput,
  type PageHandle,
  type LoadedPageSource,
} from './job-effect-pages.service';

type Client = ReturnType<typeof postgres>;
const context = new AsyncLocalStorage<Client>();
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client, a: Client, b: Client, c: Client;
const ORG = 'qc-page-org-a',
  OTHER = 'qc-page-org-b';
const operations = new Map<string, (job: BgJob, execution: JobExecution) => Promise<void>>();
const failures = new Map<string, unknown>();
const terminalFixtureJobs = new Set<string>();
const outstanding = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const scope = (tenantId = ORG): OrgScope => ({ tenantId, db: getCoreDb() });
const provider = {
  endpoint: 'https://openrouter.ai/api/v1/embeddings',
  model: 'openai/text-embedding-3-small',
  normalization: 'embedding-text-v1',
  dimensions: 1536,
};
function source(entityId: string, count = 1, text = entityId): LoadedPageSource {
  return {
    family: 'qc.page.document',
    entityId,
    sourceHash: digest(text),
    chunks: Array.from({ length: count }, (_, i) => ({ key: `chunk-${i}`, text: `${text}-${i}` })),
    requiredChunkKeys: Array.from({ length: count }, (_, i) => `chunk-${i}`),
  };
}
function input(sources: LoadedPageSource[], pageKey = 'page-1'): PageInput {
  return {
    pageKey,
    pipelineVersion: 'qc-page-v1',
    mode: 'embedded',
    expectedProvider: provider,
    servingGeneration: null,
    sources,
  };
}
const on = <T>(client: Client, operation: () => Promise<T>) => {
  const promise = context.run(client, operation);
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
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Page fixture boundary timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function embeddingResponse(body: { input: string[] }) {
  return Response.json({
    data: body.input.map((_text, index) => ({ index, embedding: Array(1536).fill(index + 0.25) })),
    usage: { prompt_tokens: 1 },
  });
}
async function documents(sources: LoadedPageSource[], tenantId = ORG) {
  for (const item of sources)
    await owner`insert into documents(tenant_id,id,source_hash,published)
    values(${tenantId},${item.entityId},${item.sourceHash},0) on conflict(tenant_id,id) do update set source_hash=excluded.source_hash`;
}
function guard(sources: LoadedPageSource[]) {
  return async (tx: CoreTx, job: BgJob) => {
    for (const item of [...sources].sort((x, y) => x.entityId.localeCompare(y.entityId))) {
      const [row] = await tx.execute<{ source_hash: string }>(
        sql`select source_hash from documents where tenant_id=${job.tenantId} and id=${item.entityId} for update`,
      );
      if (!row || row.source_hash !== item.sourceHash) throw new Error('Domain source changed');
    }
  };
}
async function newJob(client = a, tenantId = ORG) {
  return on(client, () =>
    enqueueJob({ tenantId, type: 'qc_page_effect', cursor: { retained: 'original' } }),
  );
}
async function step(
  jobId: string,
  operation: (job: BgJob, execution: JobExecution) => Promise<void>,
  client = a,
) {
  await owner`update bg_jobs set lease_until=0 where id=${jobId} and status='running'`;
  operations.set(jobId, operation);
  failures.delete(jobId);
  await on(client, () => advanceJob(jobId, 100));
  if (failures.has(jobId)) throw failures.get(jobId);
}
async function bind(jobId: string, value: PageInput, client = a) {
  let page!: PageHandle;
  await step(
    jobId,
    async (_job, execution) => {
      page = await bindJobEffectPage(
        execution,
        scope(execution.tenantId),
        value,
        guard(value.sources),
      );
    },
    client,
  );
  return page;
}
async function publish(
  execution: JobExecution,
  page: PageHandle,
  value: PageInput,
  next: Record<string, unknown> = { retained: 'original', page: 1 },
) {
  return commitJobEffectPage(
    execution,
    scope(execution.tenantId),
    page,
    guard(value.sources),
    async (tx, job, vectors) => {
      for (const item of value.sources)
        await tx.execute(
          sql`update documents set published=published+1 where tenant_id=${job.tenantId} and id=${item.entityId}`,
        );
      return vectors.map((vector) => ({ id: vector.unitId, first: vector.vector[0] }));
    },
    next,
  );
}

async function reserveWithoutDispatch(value: PageInput) {
  await documents(value.sources);
  const jobId = await newJob(),
    page = await bind(jobId, value);
  const pause = new Error('fixture stops before reserved CAS');
  let guards = 0;
  await expect(
    step(jobId, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, async (tx, current) => {
        await guard(value.sources)(tx, current);
        if (++guards > 1) throw pause;
      });
    }),
  ).rejects.toBe(pause);
  expect(fetch).not.toHaveBeenCalled();
  const [batch] =
    await owner`select id,reservation_job_id,reservation_generation,unit_ids from job_effect_batches where state='reserved' and reservation_job_id=${jobId}`;
  expect(batch).toBeDefined();
  return { jobId, page, batch: batch! };
}
async function guardedSql(operation: (tx: CoreTx) => Promise<void>) {
  const jobId = await newJob();
  return step(jobId, async (_job, execution) =>
    withOwnedJobScope(execution, scope(), async (tx) => {
      await operation(tx);
      return { value: undefined };
    }),
  );
}

beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
    CREATE TABLE bg_jobs(id text primary key,tenant_id text not null,user_id text,type text not null,ref_id text,status text not null default 'queued',
      cursor text,error text,attempts integer not null default 0,lease_until bigint,created_at bigint not null,updated_at bigint not null,started_at bigint,finished_at bigint);
    CREATE TABLE documents(tenant_id text not null,id text not null,source_hash text not null,published integer not null default 0,PRIMARY KEY(tenant_id,id));
    CREATE TABLE qc_commit_probe(id integer PRIMARY KEY,parent integer REFERENCES qc_commit_probe(id) DEFERRABLE INITIALLY DEFERRED);`);
  let legacyBefore: string | undefined;
  for (const file of [
    '20260909090100_bg_job_lease_generation.sql',
    '20260909090300_job_effect_receipts.sql',
    '20260909090400_job_request_manifest.sql',
    '20260909090500_job_effect_page_batches.sql',
  ]) {
    const ddl = readFileSync(
      new URL(`../../../supabase/migrations/${file}`, import.meta.url),
      'utf8',
    );
    if (file === '20260909090500_job_effect_page_batches.sql') {
      await owner`insert into job_effects(id,tenant_id,family,entity_id,kind,revision,unit,source_hash,state,manifest_hash)
        values(${digest('legacy-head')},${ORG},'qc.legacy','kept','head',${randomUUID()},'',${digest('legacy-source')},'active',${digest('legacy-manifest')})`;
      const [head] =
        await owner`select revision from job_effects where id=${digest('legacy-head')}`;
      await owner`insert into job_effects(id,tenant_id,family,entity_id,kind,revision,unit,source_hash,state,descriptor,result)
        values(${digest('legacy-receipt')},${ORG},'qc.legacy','kept','effect',${head!.revision},'legacy-unit',${digest('legacy-source')},'received',
        ${owner.json({ ...provider, count: 1, payloadHash: digest('legacy-payload'), pipelineVersion: 'legacy' })},
        ${owner.json([Array(1536).fill(0.125)])})`;
      const [snapshot] =
        await owner`select jsonb_agg(to_jsonb(j) order by id)::text as rows from job_effects j`;
      legacyBefore = snapshot!.rows;
    }
    // Same admitted schema-isolation transform as the existing native foundation fixture.
    await owner.unsafe(ddl.replaceAll('public.', `"${schema}".`));
  }
  const [legacyAfter] =
    await owner`select jsonb_agg(to_jsonb(j) order by id)::text as rows from job_effects j`;
  expect(legacyAfter!.rows).toBe(legacyBefore);
  await owner.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;
    GRANT SELECT,INSERT,UPDATE,DELETE ON documents TO app_ledger;
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY; ALTER TABLE documents FORCE ROW LEVEL SECURITY;
    CREATE POLICY document_org ON documents TO app_ledger USING(tenant_id=current_setting('app.current_org_id',true)) WITH CHECK(tenant_id=current_setting('app.current_org_id',true));`);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  c = harness.createConnection(schema);
  const identities = await Promise.all(
    [a, b, c].map(async (client) => {
      const [row] =
        await client`select pg_backend_pid() as pid,current_database() as database,shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()`;
      return row!;
    }),
  );
  identities.forEach((identity) =>
    expect(identity).toMatchObject({
      database: harness.identity.database,
      marker: harness.identity.marker,
    }),
  );
  expect(new Set(identities.map((identity) => identity.pid)).size).toBe(3);
  const [restricted] =
    await harness.owner`select rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit from pg_roles where rolname='app_ledger'`;
  expect(restricted).toMatchObject({ rolname: 'app_ledger', rolsuper: false, rolbypassrls: false });
  const [definer] =
    await harness.owner`select pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
    has_schema_privilege('app_ledger',${schema},'CREATE') as schema_create
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=${schema} and p.proname='job_effect_page_actor'`;
  expect(definer).toMatchObject({
    owner: harness.identity.owner,
    prosecdef: true,
    schema_create: false,
  });
  expect(definer!.proconfig).toContain('search_path=pg_catalog, pg_temp');
  console.log(
    'QC_PAGE_CATALOG',
    JSON.stringify({
      restricted,
      definer,
      version: harness.identity.version,
      distinctBackends: identities.length,
    }),
  );
  owner = harness.createConnection(schema);
  boundary.pool.mockImplementation(() => context.getStore() ?? a);
  registerJobHandler({
    type: 'qc_page_effect',
    advance: async (job, execution) => {
      try {
        const operation = operations.get(job.id);
        if (!operation) throw new Error('Missing page fixture operation');
        await operation(job, execution);
        const [stored] = await owner`select cursor from bg_jobs where id=${job.id}`;
        if (terminalFixtureJobs.has(job.id))
          return { done: true, cursor: stored?.cursor ? JSON.parse(stored.cursor) : {} };
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { done: false, cursor: stored?.cursor ? JSON.parse(stored.cursor) : {} };
      } catch (error) {
        failures.set(job.id, error);
        throw error;
      }
    },
  });
}, 20_000);
beforeEach(async () => {
  failures.clear();
  operations.clear();
  terminalFixtureJobs.clear();
  boundary.usage.mockClear();
  boundary.env.OPENROUTER_API_KEY = 'synthetic-page-fixture';
  boundary.env.OPENAI_API_KEY = undefined;
  await owner.unsafe(
    'TRUNCATE job_effect_units,job_effect_batches,job_effect_pages,job_effects,bg_jobs,documents,qc_commit_probe',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { input: string[] };
      return embeddingResponse(body);
    }),
  );
});
afterEach(async () => {
  releases.forEach((release) => release());
  releases.clear();
  await Promise.allSettled([...outstanding]);
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (!harness) return;
  releases.forEach((release) => release());
  releases.clear();
  try {
    // Setup905 has an explicit BEGIN. Its failure must not strand an aborted owner
    // or prevent every marked fixture connection from being closed.
    await harness.owner.unsafe('ROLLBACK');
    await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const [remaining] =
      await harness.owner`select count(*)::integer as count from pg_namespace where nspname=${schema}`;
    expect(remaining!.count).toBe(0);
  } finally {
    await harness.close();
  }
});

describe('native page effects and actual embedding transport', () => {
  it('packs changed units across documents and preserves per-page publication replay', async () => {
    const value = input([source('A', 33), source('B', 33)]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value);
    await step(jobId, async (_job, execution) => {
      expect(
        await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources)),
      ).toEqual({ state: 'ready' });
      expect(
        vi
          .mocked(fetch)
          .mock.calls.map(([, options]) => JSON.parse(String(options?.body)).input.length),
      ).toEqual([64, 2]);
      expect((await publish(execution, page, value)).replayed).toBe(false);
      expect(await publish(execution, page, value)).toEqual({ replayed: true });
      expect(await jobEffectPageAdvanceResult(execution, scope(), page)).toEqual({
        done: false,
        cursor: { retained: 'original', page: 1 },
      });
    });
    expect((await owner`select published from documents`).map((row) => row.published)).toEqual([
      1, 1,
    ]);
    expect(
      (await owner`select state from job_effect_batches`).every((row) => row.state === 'received'),
    ).toBe(true);
  });
  it('reuses B from a received A/B response while a new B/C page publishes independently', async () => {
    const first = input([source('A'), source('B')]),
      second = input([source('B'), source('C')]);
    await documents([...first.sources, second.sources[1]!]);
    const j1 = await newJob(),
      p1 = await bind(j1, first);
    await step(j1, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), p1, first.sources, guard(first.sources));
      await publish(execution, p1, first);
    });
    const j2 = await newJob(b),
      p2 = await bind(j2, second, b);
    await step(
      j2,
      async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), p2, second.sources, guard(second.sources));
        await publish(execution, p2, second);
      },
      b,
    );
    expect(
      vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)).input),
    ).toEqual([['A-0', 'B-0'], ['C-0']]);
    expect((await owner`select published from documents where id='B'`)[0]?.published).toBe(2);
    expect(await owner`select id from job_effect_units`).toHaveLength(3);
  });
  it('rejects a changed full manifest even when required chunks are unchanged', async () => {
    const value = input([source('A', 2)]);
    value.sources[0]!.requiredChunkKeys = ['chunk-0'];
    await documents(value.sources);
    const job = await newJob(),
      page = await bind(job, value);
    const changed = structuredClone(value);
    changed.sources[0]!.chunks[1]!.text = 'different unchanged chunk';
    await expect(
      step(job, async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), page, changed.sources, guard(value.sources));
      }),
    ).rejects.toMatchObject({ code: 'superseded' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await owner`select id from job_effect_batches`).toHaveLength(0);
  });
  it('rolls back domain/page/progress together while preserving received results', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const job = await newJob(),
      page = await bind(job, value);
    await step(job, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
      await expect(
        commitJobEffectPage(
          execution,
          scope(),
          page,
          guard(value.sources),
          async (tx) => {
            await tx.execute(sql`update documents set published=published+1 where id='A'`);
            throw new Error('synthetic publication failure');
          },
          { wrong: true },
        ),
      ).rejects.toThrow('synthetic publication failure');
    });
    expect((await owner`select published from documents`)[0]?.published).toBe(0);
    expect((await owner`select state from job_effect_pages`)[0]?.state).toBe('bound');
    expect((await owner`select state from job_effect_batches`)[0]?.state).toBe('received');
    expect(
      JSON.parse((await owner`select cursor from bg_jobs where id=${job}`)[0]!.cursor),
    ).toEqual({ retained: 'original' });
  });
  it.each(['disabled', 'qdrant'] as const)(
    'binds and publishes %s without paid calls',
    async (mode) => {
      const value = input([source('A')]);
      value.mode = mode;
      value.expectedProvider = null;
      value.servingGeneration = mode === 'qdrant' ? 'fixture-g1' : null;
      await documents(value.sources);
      const job = await newJob(),
        page = await bind(job, value);
      await step(job, async (_job, execution) => {
        expect(
          await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources)),
        ).toEqual({ state: 'ready' });
        await publish(execution, page, value);
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(await owner`select id from job_effect_batches`).toHaveLength(0);
    },
  );
  it('pre-abort rejects before reservation and provider dispatch', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const job = await newJob(),
      page = await bind(job, value);
    await step(job, async (_job, execution) => {
      const aborted = { ...execution, signal: AbortSignal.abort() };
      await expect(
        runJobPageEmbeddings(aborted, scope(), page, value.sources, guard(value.sources)),
      ).rejects.toMatchObject({ code: 'ownership_lost' });
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await owner`select id from job_effect_batches`).toHaveLength(0);
  });
});

describe('native overlap and retained historical evidence', () => {
  it('an ambiguous B overlap stops all new C reservations and outbound calls', async () => {
    const first = input([source('A'), source('B')]),
      second = input([source('B'), source('C')]);
    await documents([...first.sources, second.sources[1]!]);
    const j1 = await newJob(),
      p1 = await bind(j1, first);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic lost provider response'));
    await expect(
      step(j1, async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), p1, first.sources, guard(first.sources));
      }),
    ).rejects.toThrow();
    const before = await owner`select id from job_effect_units order by id`;
    const j2 = await newJob(b),
      p2 = await bind(j2, second, b);
    await expect(
      step(
        j2,
        async (_job, execution) => {
          await runJobPageEmbeddings(execution, scope(), p2, second.sources, guard(second.sources));
        },
        b,
      ),
    ).rejects.toMatchObject({ code: 'indeterminate' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await owner`select id from job_effect_units order by id`).toEqual(before);
    expect(await owner`select id from job_effect_batches`).toHaveLength(1);
  });
  it('retains the complete original response after B supersession, then lets current A consume its index', async () => {
    const original = input([source('A'), source('B')]);
    await documents(original.sources);
    const j1 = await newJob(),
      p1 = await bind(j1, original);
    const pending = deferred<Response>();
    let called = false;
    vi.mocked(fetch).mockImplementationOnce(async () => {
      called = true;
      return pending.promise;
    });
    const running = step(j1, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), p1, original.sources, guard(original.sources));
    });
    // Observe the rejection now; deferred source supersession intentionally invalidates publication.
    const outcome = running.then(
      () => null,
      (error: unknown) => error,
    );
    await until(() => called);
    const changed = source('B', 1, 'B-new');
    await on(b, () =>
      createJobRequest(
        scope(),
        { family: changed.family, entityId: changed.entityId },
        changed.sourceHash,
        { type: 'qc_page_effect' },
        async (tx) => {
          await tx.execute(
            sql`update documents set source_hash=${changed.sourceHash} where tenant_id=${ORG} and id='B'`,
          );
        },
      ),
    );
    pending.resolve(embeddingResponse({ input: ['A-0', 'B-0'] }));
    expect(await outcome).toMatchObject({ code: 'superseded' });
    const [receipt] =
      await owner`select state,jsonb_array_length(result) as count from job_effect_batches`;
    expect(receipt).toMatchObject({ state: 'received', count: 2 });
    const current = input([source('A')]);
    const j2 = await newJob(b),
      p2 = await bind(j2, current, b);
    await step(
      j2,
      async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), p2, current.sources, guard(current.sources));
        await publish(execution, p2, current);
      },
      b,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await owner`select published from documents where id='A'`)[0]?.published).toBe(1);
    expect((await owner`select published from documents where id='B'`)[0]?.published).toBe(0);
  });
  it('enforces four active transport calls for a full256-unit page', async () => {
    const value = input([source('A', 256)]);
    await documents(value.sources);
    const job = await newJob(),
      page = await bind(job, value);
    const pending = deferred<void>();
    let active = 0,
      peak = 0;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      active++;
      peak = Math.max(peak, active);
      await pending.promise;
      active--;
      return embeddingResponse(JSON.parse(String(options?.body)));
    });
    const running = step(job, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
    });
    await until(() => active === 4);
    expect(peak).toBe(4);
    pending.resolve();
    await running;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(active).toBe(0);
  });
  it('uses current page identity for RLS and refuses another tenant handle', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    await documents(value.sources, OTHER);
    const job = await newJob(),
      page = await bind(job, value);
    const other = await newJob(b, OTHER);
    await step(
      other,
      async (_job, execution) => {
        expect(await loadJobEffectPage(execution, scope(OTHER), 'page-1')).toBeNull();
        await expect(
          withJobEffectPage(execution, scope(OTHER), page, guard(value.sources), async () => null),
        ).rejects.toMatchObject({ code: 'conflict' });
      },
      b,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('native reservation recovery and structural SQL guards', () => {
  it('reuses an exact unsent reservation after the prior job is invalid, without repacking', async () => {
    const value = input([source('A'), source('B')]);
    const old = await reserveWithoutDispatch(value);
    const nextId = await newJob(b),
      next = await bind(nextId, value, b);
    await step(
      nextId,
      async (_job, execution) => {
        expect(
          await runJobPageEmbeddings(execution, scope(), next, value.sources, guard(value.sources)),
        ).toEqual({ state: 'ready' });
        await publish(execution, next, value);
      },
      b,
    );
    const rows = await owner`select id,state,reservation_job_id,unit_ids from job_effect_batches`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: old.batch.id,
      state: 'received',
      reservation_job_id: nextId,
      unit_ids: old.batch.unit_ids,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('yields for a live owner and preserves canonical cursor, units and reservation', async () => {
    const value = input([source('A'), source('B')]);
    const old = await reserveWithoutDispatch(value);
    await owner`update bg_jobs set status='running',lease_until=${Date.now() + 60_000} where id=${old.jobId}`;
    const nextId = await newJob(b),
      next = await bind(nextId, value, b);
    const before = await owner`select to_jsonb(b) as row from job_effect_batches b`;
    await step(
      nextId,
      async (_job, execution) => {
        expect(
          await runJobPageEmbeddings(execution, scope(), next, value.sources, guard(value.sources)),
        ).toEqual({
          state: 'busy',
          reason: 'owner_busy',
          advance: { done: false, cursor: { retained: 'original' } },
        });
      },
      b,
    );
    expect(await owner`select to_jsonb(b) as row from job_effect_batches b`).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns owner_missing for an orphan without modifying any reservation', async () => {
    const value = input([source('A')]);
    const old = await reserveWithoutDispatch(value);
    await owner`delete from bg_jobs where id=${old.jobId}`;
    const nextId = await newJob(b),
      next = await bind(nextId, value, b);
    await expect(
      step(
        nextId,
        async (_job, execution) => {
          await runJobPageEmbeddings(execution, scope(), next, value.sources, guard(value.sources));
        },
        b,
      ),
    ).rejects.toMatchObject({ code: 'owner_missing' });
    expect((await owner`select id,state from job_effect_batches`)[0]).toEqual({
      id: old.batch.id,
      state: 'reserved',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('yields promptly when a foreign owner row is locked on a distinct connection', async () => {
    const value = input([source('A')]);
    const old = await reserveWithoutDispatch(value);
    const nextId = await newJob(b),
      next = await bind(nextId, value, b);
    const locked = deferred<void>(),
      release = deferred<void>();
    const held = on(c, () =>
      c.begin(async (tx) => {
        await tx`select id from bg_jobs where id=${old.jobId} for update`;
        locked.resolve();
        await release.promise;
      }),
    );
    await locked.promise;
    try {
      await step(
        nextId,
        async (_job, execution) => {
          expect(
            (
              await runJobPageEmbeddings(
                execution,
                scope(),
                next,
                value.sources,
                guard(value.sources),
              )
            ).state,
          ).toBe('busy');
        },
        b,
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await held;
    }
  });
  it('abandons every old companion placement and repacks only current A/C together', async () => {
    const old = await reserveWithoutDispatch(input([source('A'), source('B')]));
    const value = input([source('A'), source('C')]);
    await documents(value.sources);
    const nextId = await newJob(b),
      next = await bind(nextId, value, b);
    await step(
      nextId,
      async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), next, value.sources, guard(value.sources));
        await publish(execution, next, value);
      },
      b,
    );
    const [tombstone] =
      await owner`select state,unit_ids from job_effect_batches where id=${old.batch.id}`;
    expect(tombstone).toEqual({ state: 'abandoned_unsent', unit_ids: old.batch.unit_ids });
    expect(
      await owner`select id from job_effect_units where batch_id=${old.batch.id}`,
    ).toHaveLength(0);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)).input).toEqual([
      'A-0',
      'C-0',
    ]);
    expect(await owner`select id from job_effect_units where batch_id is null`).toHaveLength(1);
    await expect(
      guardedSql(async (tx) => {
        await tx.execute(
          sql`update job_effect_batches set abandonment_reason='changed' where id=${old.batch.id}`,
        );
      }),
    ).rejects.toThrow();
    expect(
      (await owner`select state from job_effect_batches where id=${old.batch.id}`)[0]!.state,
    ).toBe('abandoned_unsent');
  });
  it('rolls back an incomplete companion release at outer commit after actor restoration', async () => {
    const old = await reserveWithoutDispatch(input([source('A'), source('B')]));
    const jobId = await newJob(b);
    await expect(
      step(
        jobId,
        async (_job, execution) => {
          await withOwnedJobScope(
            execution,
            scope(),
            async (tx) => {
              await tx.execute(
                sql`update job_effect_batches set state='abandoned_unsent',abandonment_reason='fixture' where id=${old.batch.id}`,
              );
              await tx.execute(
                sql`update job_effect_units set batch_id=null,vector_index=null where id=${old.batch.unit_ids[0]}`,
              );
              return { value: undefined, nextProgress: { shouldNotPersist: true } };
            },
            {
              foreignReservationOwners: [
                { jobId: old.jobId, reservationGeneration: old.batch.reservation_generation },
              ],
            },
          );
        },
        b,
      ),
    ).rejects.toThrow(/abandoned batch retains/);
    expect(
      (await owner`select state from job_effect_batches where id=${old.batch.id}`)[0]!.state,
    ).toBe('reserved');
    expect(
      await owner`select id from job_effect_units where batch_id=${old.batch.id}`,
    ).toHaveLength(2);
    expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
      '{"retained":"original"}',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('denies undeclared foreign recovery before touching a locked foreign owner', async () => {
    const old = await reserveWithoutDispatch(input([source('A')]));
    const locked = deferred<void>(),
      release = deferred<void>();
    const held = on(c, () =>
      c.begin(async (tx) => {
        await tx`select id from bg_jobs where id=${old.jobId} for update`;
        locked.resolve();
        await release.promise;
      }),
    );
    await locked.promise;
    try {
      await expect(
        guardedSql(async (tx) => {
          await tx.execute(
            sql`update job_effect_batches set state='abandoned_unsent',abandonment_reason='undeclared' where id=${old.batch.id}`,
          );
        }),
      ).rejects.toMatchObject({
        cause: { code: '23514', message: 'undeclared reservation owner' },
      });
    } finally {
      release.resolve();
      await held;
    }
  });
  it('denies missing actor context and grants no direct job or actor-function authority', async () => {
    const old = await reserveWithoutDispatch(input([source('A')]));
    await expect(
      owner.begin(async (tx) => {
        await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${ORG},true)`;
        await tx`update job_effect_batches set state='abandoned_unsent',abandonment_reason='no-actor' where id=${old.batch.id}`;
      }),
    ).rejects.toThrow(/actor context/);
    const [acl] =
      await owner`select has_table_privilege('app_ledger',${schema + '.bg_jobs'},'SELECT') as job_read,
      has_table_privilege('app_ledger',${schema + '.bg_jobs'},'UPDATE') as job_write,
      has_function_privilege('app_ledger',${schema + '.job_effect_page_actor(text,text,integer,text,integer)'},'EXECUTE') as actor_execute`;
    expect(acl).toEqual({ job_read: false, job_write: false, actor_execute: false });
  });
  it('uses immediate actor context and restores it before returning from owned scope', async () => {
    const jobId = await newJob();
    await step(jobId, async (_job, execution) => {
      await withOwnedJobScope(execution, scope(), async (tx) => {
        const [row] = await tx.execute(sql`select current_setting('app.job_effect_job_id') as actor,
          current_setting('app.job_effect_lease_generation') as generation,current_setting('app.job_effect_prelocked_owners') as owners,current_user as role`);
        expect(row).toMatchObject({
          actor: jobId,
          generation: String(execution.leaseGeneration),
          owners: '[]',
          role: 'app_ledger',
        });
        return { value: undefined, nextProgress: { saved: true } };
      });
      const [after] =
        await a`select nullif(current_setting('app.job_effect_job_id',true),'') as actor,
        nullif(current_setting('app.job_effect_lease_generation',true),'') as generation,current_user as role`;
      expect(after).toMatchObject({ actor: null, generation: null });
      expect(after!.role).not.toBe('app_ledger');
    });
    expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
      '{"saved":true}',
    );
  });
});

describe('native stale actors and immutable received evidence', () => {
  it('retains no returned response after the original dispatch generation is replaced', async () => {
    const value = input([source('A'), source('B')]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value),
      pending = deferred<Response>();
    let started = false;
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started = true;
      return pending.promise;
    });
    const outcome = step(jobId, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
    }).then(
      () => null,
      (error: unknown) => error,
    );
    await until(() => started);
    await owner`update bg_jobs set lease_generation=lease_generation+1 where id=${jobId}`;
    pending.resolve(embeddingResponse({ input: ['A-0', 'B-0'] }));
    expect(await outcome).toMatchObject({ code: 'ownership_lost' });
    expect((await owner`select state,result from job_effect_batches`)[0]).toEqual({
      state: 'admitted',
      result: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['', '0', '-1', 'not-a-generation', '2147483648'])(
    'rejects malformed or out-of-range actor generation %j',
    async (generation) => {
      const old = await reserveWithoutDispatch(input([source('A')]));
      await expect(
        guardedSql(async (tx) => {
          await tx.execute(
            sql`select set_config('app.job_effect_lease_generation',${generation},true)`,
          );
          await tx.execute(
            sql`update job_effect_units set vector_index=vector_index where id=${old.batch.unit_ids[0]}`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      expect(
        (await owner`select state from job_effect_batches where id=${old.batch.id}`)[0]!.state,
      ).toBe('reserved');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects moving a received placement, replacing received values or mutating its descriptor', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value);
    await step(jobId, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
    });
    const [batch] = await owner`select id,result from job_effect_batches`;
    const before = await owner`select to_jsonb(b) as row from job_effect_batches b`;
    await expect(
      guardedSql(async (tx) => {
        await tx.execute(
          sql`update job_effect_units set batch_id=null,vector_index=null where batch_id=${batch!.id}`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      guardedSql(async (tx) => {
        await tx.execute(
          sql`update job_effect_batches set result=${JSON.stringify([Array(1536).fill(9)])}::jsonb where id=${batch!.id}`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      guardedSql(async (tx) => {
        await tx.execute(
          sql`update job_effect_batches set descriptor=jsonb_set(descriptor,'{model}','"changed"') where id=${batch!.id}`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    expect(await owner`select to_jsonb(b) as row from job_effect_batches b`).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

/** Observe the real selected-return query, forwarding its exact transaction/results. */
function observeProjection(
  execution: JobExecution,
  observations: { bytes: number; payloadBytes: number | null; count: number }[],
): JobExecution {
  const dialect = new PgDialect();
  return {
    ...execution,
    withOwnership: (operation) =>
      execution.withOwnership(async (tx, current) => {
        const observed = new Proxy(tx, {
          get(target, key) {
            if (key === 'execute')
              return async (query: SQL) => {
                const result = await target.execute(query);
                if (dialect.sqlToQuery(query).sql.includes('projected AS MATERIALIZED')) {
                  const row = result[0] as {
                    total_bytes: string | number;
                    payload: string | null;
                    count: number;
                  };
                  observations.push({
                    bytes: Number(row.total_bytes),
                    payloadBytes: row.payload === null ? null : Buffer.byteLength(row.payload),
                    count: row.count,
                  });
                }
                return result;
              };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return operation(observed, current);
      }),
  };
}

describe('native selected vector return ceiling', () => {
  it.each([16_777_216, 16_777_217])(
    'conditions actual result return on %i exact serialized bytes',
    async (targetBytes) => {
      const value = input([source('A', 256)]),
        old = await reserveWithoutDispatch(value);
      const jobId = await newJob(b),
        page = await bind(jobId, value, b);
      await step(
        jobId,
        async (_job, execution) => {
          await withOwnedJobScope(
            execution,
            scope(),
            async (tx, current) => {
              await tx.execute(
                sql`select id from job_effects where tenant_id=${ORG} and kind='head' order by id for update`,
              );
              await guard(value.sources)(tx, current);
              const batches = await tx.execute<{ id: string; unit_ids: string[] }>(
                sql`select id,unit_ids from job_effect_batches where tenant_id=${ORG} order by id for update`,
              );
              await tx.execute(
                sql`select id from job_effect_units where tenant_id=${ORG} order by id for update`,
              );
              // Finite PostgreSQL numeric scale is retained in JSONB text. This tests the wire
              // ceiling separately from the existing 4MB binary JSONB storage validator.
              const [base] = await tx.execute<{
                size: string;
              }>(sql`select (sum(octet_length(jsonb_build_object('sourceKey',head_id,'chunkKey',chunk_key,'unitId',id,
          'vector',to_jsonb(array_fill(1::numeric,ARRAY[1536])) )::text))+count(*)-1+2)::text as size from job_effect_units where tenant_id=${ORG}`);
              const delta = targetBytes - Number(base!.size),
                components = 256 * 1536;
              const extra = Math.floor(delta / components),
                remainder = delta % components;
              expect(extra).toBeGreaterThan(1);
              for (const batch of batches) {
                await tx.execute(
                  sql`update job_effect_batches set reservation_job_id=${jobId},reservation_generation=${execution.leaseGeneration} where id=${batch.id}`,
                );
                await tx.execute(
                  sql`update job_effect_batches set state='admitted',dispatch_job_id=${jobId},dispatch_generation=${execution.leaseGeneration} where id=${batch.id}`,
                );
                await tx.execute(sql`update job_effect_batches set state='received',result=(
            select jsonb_agg(vector order by ordinal) from (
              select members.ordinality as ordinal,(select jsonb_agg(
                ('1.'||repeat('0',${extra - 1}+case when split_part(u.chunk_key,'-',2)::integer*1536+dimension < ${remainder} then 1 else 0 end))::numeric order by dimension)
                from generate_series(0,1535) dimension) as vector
              from jsonb_array_elements_text(${JSON.stringify(batch.unit_ids)}::jsonb) with ordinality members(id,ordinality)
              join job_effect_units u on u.id=members.id and u.tenant_id=${ORG}
            ) vectors) where id=${batch.id}`);
              }
              return { value: undefined };
            },
            {
              foreignReservationOwners: [
                { jobId: old.jobId, reservationGeneration: old.batch.reservation_generation },
              ],
            },
          );
        },
        b,
      );
      const observations: { bytes: number; payloadBytes: number | null; count: number }[] = [];
      const attempt = step(
        jobId,
        async (_job, execution) => {
          await publish(observeProjection(execution, observations), page, value);
        },
        b,
      );
      if (targetBytes === 16_777_216) {
        await attempt;
        expect(observations).toEqual([
          { bytes: targetBytes, payloadBytes: targetBytes, count: 256 },
        ]);
        expect((await owner`select published from documents where id='A'`)[0]!.published).toBe(1);
      } else {
        await expect(attempt).rejects.toMatchObject({ code: 'capacity' });
        expect(observations).toEqual([{ bytes: targetBytes, payloadBytes: null, count: 256 }]);
        expect((await owner`select published from documents where id='A'`)[0]!.published).toBe(0);
        expect(
          (await owner`select state from job_effect_pages where id=${page.id}`)[0]!.state,
        ).toBe('bound');
        expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
          '{"retained":"original"}',
        );
      }
      expect(
        (
          await owner`select count(*)::integer as count from job_effect_batches where state='received'`
        )[0]!.count,
      ).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
      console.log('QC_PAGE_PROJECTION', JSON.stringify(observations));
    },
    20_000,
  );
});

describe('native concurrent frontier and committed dispatch permits', () => {
  it('serializes simultaneous missing B and returns canonical busy for a changed frontier', async () => {
    const left = input([source('A'), source('B')]),
      right = input([source('B'), source('C')]);
    await documents([...left.sources, ...right.sources]);
    const leftJob = await newJob(a),
      rightJob = await newJob(b);
    const leftPage = await bind(leftJob, left, a),
      rightPage = await bind(rightJob, right, b);
    const observed = deferred<void>();
    let count = 0;
    const pauseAfterDiscovery = (execution: JobExecution): JobExecution => {
      let paused = false;
      return {
        ...execution,
        withOwnership: async (operation) => {
          const result = await execution.withOwnership(operation);
          if (!paused && result && typeof result === 'object' && 'fingerprint' in result) {
            // Actual metadata-discovery transaction has committed; no lock is held here.
            paused = true;
            if (++count === 2) observed.resolve();
            await observed.promise;
          }
          return result;
        },
      };
    };
    const results: ('ready' | 'busy')[] = [];
    await Promise.all([
      step(
        leftJob,
        async (_job, execution) => {
          results[0] = (
            await runJobPageEmbeddings(
              pauseAfterDiscovery(execution),
              scope(),
              leftPage,
              left.sources,
              guard(left.sources),
            )
          ).state;
        },
        a,
      ),
      step(
        rightJob,
        async (_job, execution) => {
          results[1] = (
            await runJobPageEmbeddings(
              pauseAfterDiscovery(execution),
              scope(),
              rightPage,
              right.sources,
              guard(right.sources),
            )
          ).state;
        },
        b,
      ),
    ]);
    expect(results.sort()).toEqual(['busy', 'ready']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await owner`select count(*)::integer as count from job_effect_units where head_id=(select id from job_effects where entity_id='B')`
      )[0]!.count,
    ).toBe(1);
    await step(
      leftJob,
      async (_job, execution) => {
        await runJobPageEmbeddings(execution, scope(), leftPage, left.sources, guard(left.sources));
        await publish(execution, leftPage, left);
      },
      a,
    );
    await step(
      rightJob,
      async (_job, execution) => {
        await runJobPageEmbeddings(
          execution,
          scope(),
          rightPage,
          right.sources,
          guard(right.sources),
        );
        await publish(execution, rightPage, right);
      },
      b,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await owner`select count(*)::integer as count from job_effect_units`)[0]!.count).toBe(
      3,
    );
    expect((await owner`select published from documents where id='B'`)[0]!.published).toBe(2);
  }, 10_000);
  it('never grants a dispatch permit when the actual admission COMMIT fails a deferred constraint', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value);
    let forced = false;
    await expect(
      step(jobId, async (_job, execution) => {
        const candidate: JobExecution = {
          ...execution,
          withOwnership: (operation) =>
            execution.withOwnership(async (tx, current) => {
              const result = await operation(tx, current);
              if (result === true && !forced) {
                // The real admission CAS returned true, but the real outer COMMIT must reject.
                // This is an ordinary fixture FK error, not a driver/process/socket fault.
                forced = true;
                await tx.execute(sql`insert into qc_commit_probe(id,parent) values(1,999)`);
              }
              return result;
            }),
        };
        await runJobPageEmbeddings(candidate, scope(), page, value.sources, guard(value.sources));
      }),
    ).rejects.toMatchObject({ code: '23503' });
    expect(forced).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect((await owner`select state,dispatch_job_id from job_effect_batches`)[0]).toEqual({
      state: 'reserved',
      dispatch_job_id: null,
    });
    expect(await owner`select * from qc_commit_probe`).toHaveLength(0);
    expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
      '{"retained":"original"}',
    );
  });
});

describe('native provider pinning and scoped reads', () => {
  it('refuses a changed provider before binding any page or head', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const jobId = await newJob();
    boundary.env.OPENROUTER_API_KEY = undefined;
    boundary.env.OPENAI_API_KEY = 'synthetic-alternate';
    await expect(bind(jobId, value)).rejects.toMatchObject({ code: 'conflict' });
    expect(await owner`select id from job_effect_pages`).toHaveLength(0);
    expect(await owner`select id from job_effects`).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the real private prepared endpoint after environment changes between reservation and dispatch', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value);
    let changed = false;
    await step(jobId, async (_job, execution) => {
      const observed: JobExecution = {
        ...execution,
        withOwnership: async (operation) => {
          const result = await execution.withOwnership(operation);
          if (
            !changed &&
            Array.isArray(result) &&
            result[0] &&
            typeof result[0] === 'object' &&
            'request' in result[0]
          ) {
            changed = true;
            boundary.env.OPENROUTER_API_KEY = undefined;
            boundary.env.OPENAI_API_KEY = 'synthetic-alternate';
          }
          return result;
        },
      };
      await runJobPageEmbeddings(observed, scope(), page, value.sources, guard(value.sources));
    });
    expect(changed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(provider.endpoint);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)).model).toBe(provider.model);
    expect(
      (await owner`select descriptor->>'endpoint' as endpoint,state from job_effect_batches`)[0],
    ).toEqual({ endpoint: provider.endpoint, state: 'received' });
  });
  it.each(['short', 'wrong-count'])(
    'leaves admission ambiguous after malformed %s provider vectors',
    async (shape) => {
      const value = input([source('A')]);
      await documents(value.sources);
      const jobId = await newJob(),
        page = await bind(jobId, value);
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ data: shape === 'short' ? [{ index: 0, embedding: [1, 2] }] : [] }),
      );
      await expect(
        step(jobId, async (_job, execution) => {
          await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
        }),
      ).rejects.toThrow();
      expect((await owner`select state,result from job_effect_batches`)[0]).toEqual({
        state: 'admitted',
        result: null,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('uses actual escaped prepared JSON across documents without changing payload bytes', async () => {
    const value = input([
      source('A', 32, '\u0001'.repeat(8000)),
      source('B', 32, '\u0001'.repeat(8000)),
    ]);
    await documents(value.sources);
    const jobId = await newJob(),
      page = await bind(jobId, value);
    await step(jobId, async (_job, execution) => {
      await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
    });
    const body = String(vi.mocked(fetch).mock.calls[0]![1]!.body),
      decoded = JSON.parse(body);
    expect(decoded.input).toHaveLength(64);
    expect(decoded.input.every((text: string) => text === '\u0001'.repeat(8000))).toBe(true);
    expect(Buffer.byteLength(body)).toBe(
      Buffer.byteLength(
        JSON.stringify({ model: provider.model, input: Array(64).fill('\u0001'.repeat(8000)) }),
      ),
    );
    expect(
      (await owner`select descriptor->>'payloadHash' as hash from job_effect_batches`)[0]!.hash,
    ).toBe(digest(body));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('filters unqualified page reads under the actual scoped role across tenants', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    await documents(value.sources, OTHER);
    const own = await newJob(a),
      other = await newJob(b, OTHER);
    await bind(own, value, a);
    await bind(other, value, b);
    await step(own, async (_job, execution) => {
      await withOwnedJobScope(execution, scope(), async (tx) => {
        const rows = await tx.execute<{ tenant_id: string }>(
          sql`select tenant_id from job_effect_pages`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.tenant_id).toBe(ORG);
        return { value: undefined };
      });
    });
  });
});

describe('native complete foreign companion closure', () => {
  it.each([1024, 1025])(
    'counts all %i companion units and heads before any recovery writes',
    async (total) => {
      const selected: LoadedPageSource[] = [];
      for (let group = 0; group < Math.ceil(total / 64); group++) {
        const count = Math.min(64, total - group * 64);
        const sources = Array.from({ length: count }, (_, index) =>
          source(`closure-${group}-${index}`),
        );
        await reserveWithoutDispatch(input(sources));
        selected.push(sources[0]!);
      }
      const value = input(selected),
        jobId = await newJob(b),
        page = await bind(jobId, value, b);
      const attempt = step(
        jobId,
        async (_job, execution) => {
          await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
        },
        b,
      );
      if (total === 1024) {
        await attempt;
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)).input).toHaveLength(16);
        expect(
          (
            await owner`select count(*)::integer as count from job_effect_batches where state='abandoned_unsent'`
          )[0]!.count,
        ).toBe(16);
        expect(
          (
            await owner`select count(*)::integer as count from job_effect_units where batch_id is null`
          )[0]!.count,
        ).toBe(1008);
      } else {
        await expect(attempt).rejects.toMatchObject({ code: 'capacity' });
        expect(fetch).not.toHaveBeenCalled();
        expect(
          (
            await owner`select count(*)::integer as count from job_effect_batches where state='reserved'`
          )[0]!.count,
        ).toBe(17);
        expect(
          (
            await owner`select count(*)::integer as count from job_effect_units where batch_id is null`
          )[0]!.count,
        ).toBe(0);
        expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
          '{"retained":"original"}',
        );
      }
      expect((await owner`select count(*)::integer as count from job_effect_units`)[0]!.count).toBe(
        total,
      );
    },
    20_000,
  );
});

describe('native persisted descriptor byte ceiling', () => {
  it('accepts exactly256KiB jsonb text and rolls back every head/page/cursor change one byte over', async () => {
    const base = input(Array.from({ length: 64 }, (_, index) => source(`descriptor-${index}`, 4)));
    base.mode = 'disabled';
    base.expectedProvider = null;
    for (const item of base.sources) for (const chunk of item.chunks) chunk.text = '';
    await documents(base.sources);
    const initialJob = await newJob(),
      initialPage = await bind(initialJob, base);
    const [size] =
      await owner`select octet_length(descriptor::text) as bytes from job_effect_pages where id=${initialPage.id}`;
    const exact = structuredClone(base);
    let remaining = 262_144 - Number(size!.bytes);
    expect(remaining).toBeGreaterThan(0);
    if (remaining % 2) {
      exact.sources[0]!.entityId += 'x';
      remaining--;
    }
    for (const item of exact.sources) {
      item.sourceHash = digest(item.sourceHash + 'exact');
      for (const chunk of item.chunks) {
        while (chunk.key.length < 160 && remaining > 0) {
          const character = remaining >= 12 ? '\u0001' : 'a';
          chunk.key += character;
          remaining -= character === '\u0001' ? 12 : 2;
        }
      }
      item.requiredChunkKeys = item.chunks.map((chunk) => chunk.key);
    }
    expect(remaining).toBe(0);
    await documents(exact.sources);
    const exactJob = await newJob(),
      exactPage = await bind(exactJob, exact);
    expect(
      (
        await owner`select octet_length(descriptor::text) as bytes from job_effect_pages where id=${exactPage.id}`
      )[0]!.bytes,
    ).toBe(262_144);
    const oversized = structuredClone(exact);
    oversized.sources[0]!.entityId += 'x';
    for (const item of oversized.sources) item.sourceHash = digest(item.sourceHash + 'over');
    await documents(oversized.sources);
    const failedJob = await newJob();
    const heads = await owner`select to_jsonb(h) as row from job_effects h order by id`;
    const pages = await owner`select to_jsonb(p) as row from job_effect_pages p order by id`;
    await expect(bind(failedJob, oversized)).rejects.toMatchObject({ code: 'capacity' });
    expect(await owner`select to_jsonb(h) as row from job_effects h order by id`).toEqual(heads);
    expect(await owner`select to_jsonb(p) as row from job_effect_pages p order by id`).toEqual(
      pages,
    );
    expect((await owner`select cursor from bg_jobs where id=${failedJob}`)[0]!.cursor).toBe(
      '{"retained":"original"}',
    );
    expect(await owner`select id from job_effect_batches`).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  }, 10_000);
});

describe('native full foreign metadata capacity', () => {
  it.each([1_048_576, 1_048_577])(
    'checks exactly %i metadata bytes before recovery',
    async (target) => {
      const baseSources = Array.from({ length: 64 }, (_, index) => source(`base-${index}`));
      await reserveWithoutDispatch(input(baseSources));
      const baseline = input([baseSources[0]!]),
        probeJob = await newJob(b),
        probePage = await bind(probeJob, baseline, b);
      const stopped = new Error('fixture observes completed discovery before recovery');
      type Observation = {
        units: unknown[];
        batches: unknown[];
        heads: string[];
        owners: unknown[];
      };
      let probe: Observation | undefined;
      const observe = (
        execution: JobExecution,
        record: (value: Observation) => void,
      ): JobExecution => ({
        ...execution,
        withOwnership: async (operation) => {
          const result = await execution.withOwnership(operation);
          if (result && typeof result === 'object' && 'fingerprint' in result) {
            if (
              !('units' in result) ||
              !Array.isArray(result.units) ||
              !('batches' in result) ||
              !Array.isArray(result.batches) ||
              !('heads' in result) ||
              !Array.isArray(result.heads) ||
              !result.heads.every((head: unknown) => typeof head === 'string') ||
              !('owners' in result) ||
              !Array.isArray(result.owners)
            )
              throw new Error('Unexpected real discovery shape');
            record({
              units: result.units,
              batches: result.batches,
              heads: result.heads,
              owners: result.owners,
            });
            throw stopped;
          }
          return result;
        },
      });
      await expect(
        step(
          probeJob,
          async (_job, execution) => {
            await runJobPageEmbeddings(
              observe(execution, (value) => {
                probe = value;
              }),
              scope(),
              probePage,
              baseline.sources,
              guard(baseline.sources),
            );
          },
          b,
        ),
      ).rejects.toBe(stopped);
      expect(probe).toBeDefined();
      // Predict framing using real64-member row shapes; all actual IDs/hashes have fixed
      // length. This calculation never supplies fake rows to the service or database.
      const repeated = {
        units: Array.from({ length: 11 }, () => probe!.units).flat(),
        batches: Array.from({ length: 11 }, () => probe!.batches).flat(),
        heads: Array.from({ length: 11 }, () => probe!.heads).flat(),
        owners: Array.from({ length: 11 }, () => probe!.owners).flat(),
      };
      let remaining = target - Buffer.byteLength(JSON.stringify(repeated));
      expect(remaining).toBeGreaterThan(0);
      const selected: LoadedPageSource[] = [],
        batchIds: string[] = [];
      for (let group = 0; group < 11; group++) {
        const sources = Array.from({ length: 64 }, (_, index) =>
          source(`metadata-${group}-${index}`),
        );
        for (const item of sources) {
          const chunk = item.chunks[0]!;
          while (chunk.key.length < 160 && remaining > 0) {
            const character = remaining >= 6 ? '\u0001' : 'a';
            chunk.key += character;
            remaining -= character === '\u0001' ? 6 : 1;
          }
          item.requiredChunkKeys = [chunk.key];
        }
        const old = await reserveWithoutDispatch(input(sources));
        batchIds.push(old.batch.id);
        selected.push(sources[0]!);
      }
      expect(remaining).toBe(0);
      // Independently inspect the actual native mapped rows, omitting result exactly as
      // the production metadata projection does. No source/payload is synthesized here.
      const actual = await on(b, async () => {
        const db = getCoreDb();
        const units = await db
          .select()
          .from(jobEffectUnits)
          .where(inArray(jobEffectUnits.batchId, batchIds));
        const rows = await db
          .select()
          .from(jobEffectBatches)
          .where(inArray(jobEffectBatches.id, batchIds));
        const batches = rows.map(({ result: _, ...batch }) => batch);
        return {
          units,
          batches,
          heads: [...new Set(units.map((unit) => unit.headId))],
          owners: batches.map((batch) => ({
            jobId: batch.reservationJobId,
            reservationGeneration: batch.reservationGeneration,
          })),
        };
      });
      expect(Buffer.byteLength(JSON.stringify(actual))).toBe(target);
      const value = input(selected),
        jobId = await newJob(b),
        page = await bind(jobId, value, b);
      let reached = false;
      const attempt = step(
        jobId,
        async (_job, execution) => {
          await runJobPageEmbeddings(
            observe(execution, (metadata) => {
              reached = true;
              expect(Buffer.byteLength(JSON.stringify(metadata))).toBe(target);
            }),
            scope(),
            page,
            value.sources,
            guard(value.sources),
          );
        },
        b,
      );
      if (target === 1_048_576) {
        await expect(attempt).rejects.toBe(stopped);
        expect(reached).toBe(true);
      } else {
        await expect(attempt).rejects.toMatchObject({
          code: 'capacity',
          message: 'Foreign metadata closure exceeded',
        });
        expect(reached).toBe(false);
      }
      expect(
        (
          await owner`select count(*)::integer as count from job_effect_batches where state='reserved'`
        )[0]!.count,
      ).toBe(12);
      expect(
        (
          await owner`select count(*)::integer as count from job_effect_units where batch_id is null`
        )[0]!.count,
      ).toBe(0);
      expect((await owner`select cursor from bg_jobs where id=${jobId}`)[0]!.cursor).toBe(
        '{"retained":"original"}',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
    20_000,
  );
});

describe('native maximum owner frontier and independent head limit', () => {
  it('admits256 distinct historical batches and prelocks256 actual finished owner jobs', async () => {
    const value = input(Array.from({ length: 64 }, (_, index) => source(`owner-${index}`, 4)));
    const old = await reserveWithoutDispatch(value),
      releaseJob = await newJob(b);
    terminalFixtureJobs.add(releaseJob);
    await step(
      releaseJob,
      async (_job, execution) => {
        await withOwnedJobScope(
          execution,
          scope(),
          async (tx) => {
            await tx.execute(
              sql`select id from job_effects where tenant_id=${ORG} order by id for update`,
            );
            await tx.execute(
              sql`select id from job_effect_batches where tenant_id=${ORG} order by id for update`,
            );
            await tx.execute(
              sql`select id from job_effect_units where tenant_id=${ORG} order by id for update`,
            );
            await tx.execute(
              sql`update job_effect_batches set state='abandoned_unsent',abandonment_reason='fixture historic single-unit partition' where tenant_id=${ORG}`,
            );
            await tx.execute(
              sql`update job_effect_units set batch_id=null,vector_index=null where tenant_id=${ORG}`,
            );
            return { value: undefined };
          },
          {
            foreignReservationOwners: [
              { jobId: old.jobId, reservationGeneration: old.batch.reservation_generation },
            ],
          },
        );
      },
      b,
    );
    const units = await on(b, () => getCoreDb().select().from(jobEffectUnits));
    for (const unit of units) {
      const sourceValue = value.sources.find((item) => jobEffectHeadId(ORG, item) === unit.headId)!;
      const text = sourceValue.chunks.find((chunk) => chunk.key === unit.chunkKey)!.text;
      const descriptor = {
        ...prepareEmbeddingRequest([text]).descriptor,
        pipelineVersion: value.pipelineVersion,
      };
      const jobId = await newJob(b);
      terminalFixtureJobs.add(jobId);
      await step(
        jobId,
        async (_job, execution) => {
          await withOwnedJobScope(execution, scope(), async (tx) => {
            await tx.execute(sql`select id from job_effects where id=${unit.headId} for update`);
            const id = digest(randomUUID()),
              members = [unit.id];
            await tx.execute(sql`insert into job_effect_batches(id,tenant_id,reservation_job_id,reservation_generation,descriptor,unit_ids,membership_hash,count,state)
            values(${id},${ORG},${jobId},${execution.leaseGeneration},${JSON.stringify(descriptor)}::jsonb,${JSON.stringify(members)}::jsonb,${digest(JSON.stringify(members))},1,'reserved')`);
            await tx.execute(
              sql`update job_effect_units set batch_id=${id},vector_index=0 where id=${unit.id}`,
            );
            return { value: undefined };
          });
        },
        b,
      );
    }
    expect(
      (
        await owner`select count(distinct reservation_job_id)::integer as count from job_effect_batches where state='reserved'`
      )[0]!.count,
    ).toBe(256);
    const probeJob = await newJob(b),
      page = await bind(probeJob, value, b),
      stopped = new Error('bounded frontier observed');
    let checked = false;
    await expect(
      step(
        probeJob,
        async (_job, execution) => {
          const observed: JobExecution = {
            ...execution,
            withOwnership: async (operation) => {
              const result = await execution.withOwnership(operation);
              if (
                result &&
                typeof result === 'object' &&
                'fingerprint' in result &&
                'owners' in result &&
                Array.isArray(result.owners) &&
                'batches' in result &&
                Array.isArray(result.batches)
              ) {
                expect(result.batches).toHaveLength(256);
                expect(result.owners).toHaveLength(256);
                const refs = result.owners.map((ref: unknown) => {
                  if (
                    !ref ||
                    typeof ref !== 'object' ||
                    !('jobId' in ref) ||
                    typeof ref.jobId !== 'string' ||
                    !('reservationGeneration' in ref) ||
                    typeof ref.reservationGeneration !== 'number'
                  )
                    throw new Error('Unexpected owner reference');
                  return { jobId: ref.jobId, reservationGeneration: ref.reservationGeneration };
                });
                await withOwnedJobScope(
                  execution,
                  scope(),
                  async (tx) => {
                    const [context] = await tx.execute<{ count: number }>(
                      sql`select jsonb_array_length(current_setting('app.job_effect_prelocked_owners')::jsonb) as count`,
                    );
                    expect(context!.count).toBe(256);
                    checked = true;
                    return { value: undefined };
                  },
                  { foreignReservationOwners: refs },
                );
                throw stopped;
              }
              return result;
            },
          };
          await runJobPageEmbeddings(observed, scope(), page, value.sources, guard(value.sources));
        },
        b,
      ),
    ).rejects.toBe(stopped);
    expect(checked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await owner`select count(*)::integer as count from job_effect_batches where state='reserved'`
      )[0]!.count,
    ).toBe(256);
  }, 20_000);
  it('rejects1025 heads independently when unchanged page members expand a1024-unit companion closure', async () => {
    const selected: LoadedPageSource[] = [];
    for (let group = 0; group < 16; group++) {
      const sources = Array.from({ length: 64 }, (_, index) => source(`heads-${group}-${index}`));
      await reserveWithoutDispatch(input(sources));
      selected.push(sources[0]!);
    }
    const unchanged = source('unchanged-head', 0);
    selected.push(unchanged);
    await documents([unchanged]);
    const value = input(selected),
      jobId = await newJob(b),
      page = await bind(jobId, value, b);
    await expect(
      step(
        jobId,
        async (_job, execution) => {
          await runJobPageEmbeddings(execution, scope(), page, value.sources, guard(value.sources));
        },
        b,
      ),
    ).rejects.toMatchObject({ code: 'capacity', message: 'Foreign head closure exceeded' });
    expect((await owner`select count(*)::integer as count from job_effect_units`)[0]!.count).toBe(
      1024,
    );
    expect(
      (
        await owner`select count(*)::integer as count from job_effect_batches where state='reserved'`
      )[0]!.count,
    ).toBe(16);
    expect(fetch).not.toHaveBeenCalled();
  }, 20_000);
});

describe('native legacy and empty-page compatibility', () => {
  it('preserves an actual single-head receipt and requires recovery for its missing complete manifest', async () => {
    const value = input([source('A')]);
    await documents(value.sources);
    const item = value.sources[0]!;
    const legacy = await on(a, () =>
      createJobRequest(
        scope(),
        { family: item.family, entityId: item.entityId },
        item.sourceHash,
        { type: 'qc_page_effect' },
        async () => undefined,
      ),
    );
    await step(legacy.jobId, async (_job, execution) => {
      expect(
        await runJobEmbedding(
          execution,
          scope(),
          legacy.request,
          'legacy-effect',
          [item.chunks[0]!.text],
          'legacy-pipeline',
        ),
      ).toHaveLength(1);
    });
    const before = await owner`select to_jsonb(e) as row from job_effects e order by id`;
    const next = await newJob(b);
    await expect(bind(next, value, b)).rejects.toMatchObject({
      code: 'conflict',
      message: 'Null manifest has historical effects; explicit recovery required',
    });
    expect(await owner`select to_jsonb(e) as row from job_effects e order by id`).toEqual(before);
    expect(await owner`select id from job_effect_pages`).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('binds and publishes an empty page with recorded progress and no transport', async () => {
    const value = input([]),
      jobId = await newJob(),
      page = await bind(jobId, value);
    await step(jobId, async (_job, execution) => {
      expect(await runJobPageEmbeddings(execution, scope(), page, [], guard([]))).toEqual({
        state: 'ready',
      });
      expect(await publish(execution, page, value)).toEqual({ replayed: false, value: [] });
      expect(
        await runJobPageEmbeddings(
          execution,
          scope(),
          page,
          [source('not-the-published-input')],
          guard([]),
        ),
      ).toEqual({ state: 'ready' });
      expect(await publish(execution, page, value)).toEqual({ replayed: true });
      expect(await jobEffectPageAdvanceResult(execution, scope(), page)).toEqual({
        done: false,
        cursor: { retained: 'original', page: 1 },
      });
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await owner`select id from job_effect_batches`).toHaveLength(0);
  });
});

describe('native immediate actor liveness', () => {
  it('rejects an expired same-generation actor before allowing a scoped unit statement', async () => {
    const old = await reserveWithoutDispatch(input([source('A')])),
      jobId = await newJob();
    await expect(
      step(jobId, async (_job, execution) => {
        const expired: JobExecution = {
          ...execution,
          withOwnership: (operation) =>
            execution.withOwnership(async (tx, current) => {
              await tx.execute(sql`update bg_jobs set lease_until=0 where id=${current.id}`);
              return operation(tx, current);
            }),
        };
        await withOwnedJobScope(expired, scope(), async (tx) => {
          await tx.execute(
            sql`update job_effect_units set vector_index=vector_index where id=${old.batch.unit_ids[0]}`,
          );
          return { value: undefined };
        });
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'job effect actor ownership lost' },
    });
    expect(
      (await owner`select state from job_effect_batches where id=${old.batch.id}`)[0]!.state,
    ).toBe('reserved');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not mistake a writable owner manifest for invalidation of a live foreign job', async () => {
    const old = await reserveWithoutDispatch(input([source('A')]));
    await owner`update bg_jobs set status='running',lease_until=${Date.now() + 60_000} where id=${old.jobId}`;
    await expect(
      guardedSql(async (tx) => {
        // Deliberately supplied direct-SQL labels are not proof of prior locking or
        // authentication. The immediate function must still check the live owner row.
        const manifest = JSON.stringify([
          { jobId: old.jobId, reservationGeneration: old.batch.reservation_generation },
        ]);
        await tx.execute(
          sql`select set_config('app.job_effect_prelocked_owners',${manifest},true)`,
        );
        await tx.execute(
          sql`update job_effect_batches set state='abandoned_unsent',abandonment_reason='invalid-live-reclaim' where id=${old.batch.id}`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '23514', message: 'reservation owner is live' } });
    expect(
      (await owner`select state from job_effect_batches where id=${old.batch.id}`)[0]!.state,
    ).toBe('reserved');
    expect(fetch).not.toHaveBeenCalled();
  });
});
