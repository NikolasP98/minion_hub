import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({
  pool: vi.fn(),
  audit: vi.fn(),
  products: vi.fn(),
  env: { OPENROUTER_API_KEY: 'synthetic', OPENAI_API_KEY: '' },
}));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('$server/ai-usage', () => ({ recordAiUsage: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
vi.mock('./activity.service', () => ({ recordAudit: boundary.audit }));
vi.mock('./finance-products.service', () => ({ listProducts: boundary.products }));
vi.mock('./crm-contacts.service', () => ({ listContactsCached: vi.fn(), listTags: vi.fn() }));
vi.mock('./stock.service', () => ({ listItems: vi.fn(), getBins: vi.fn() }));
vi.mock('./rbac.service', () => ({ resolveCapabilities: vi.fn() }));
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { advanceJob } from './bg-runtime';
import {
  addDocument,
  reingestDocument,
  removeDocument,
  chunkText,
  MODULE_SOURCES,
} from './brains.service';

type Client = ReturnType<typeof postgres>;
const context = new AsyncLocalStorage<Client>();
const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
const ORG = 'brain-synthetic-alpha',
  OTHER = 'brain-synthetic-beta';
const BRAIN = 'cba00000-0000-4000-8000-000000000001';
const principal = { roles: ['owner'] };
const actor = { id: 'synthetic-owner', name: 'Synthetic' };
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client, a: Client, b: Client;
const outstanding = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
function on<T>(client: Client, work: () => Promise<T>) {
  const operation = context.run(client, work);
  outstanding.add(operation);
  void operation.then(
    () => outstanding.delete(operation),
    () => outstanding.delete(operation),
  );
  return operation;
}
const scope = (tenantId = ORG) => ({ db: getCoreDb(), tenantId });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  releases.add(() => resolve(undefined as T));
  return { promise, resolve };
}
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Brain fixture did not reach expected boundary');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function embeddingResponse(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { input: string[] };
  return Response.json({
    data: body.input.map((_text, index) => ({ index, embedding: Array(1536).fill(0.25) })),
    usage: { prompt_tokens: body.input.length },
  });
}
async function document(
  contentMd = 'Synthetic brain content',
  sourceType: 'note' | 'url' = 'note',
) {
  const doc = await on(a, () =>
    addDocument(
      scope(),
      BRAIN,
      {
        title: 'Synthetic note',
        sourceType,
        contentMd,
        sourceRef: sourceType === 'url' ? 'https://8.8.8.8/brain-fixture' : null,
      },
      principal,
      actor,
    ),
  );
  const [job] = await owner`select * from bg_jobs where ref_id=${doc.id} order by created_at desc`;
  return { doc, jobId: String(job!.id) };
}
async function job(id: string) {
  const [row] = await owner`select * from bg_jobs where id=${id}`;
  return row!;
}
async function retry(id: string) {
  await owner`update bg_jobs set status='queued',lease_until=null,error=null where id=${id}`;
  await on(a, () => advanceJob(id));
}
async function chunks(docId: string) {
  return owner`select id,seq,chunk_text,extensions.vector_dims(embedding) as dimensions from brain_chunks where document_id=${docId} order by seq`;
}
beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  const [extension] =
    await owner`select extversion,nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='vector'`;
  expect(extension).toEqual({ extversion: '0.8.6', nspname: 'extensions' });
  expect(harness.identity.database).toBe('minion_qc_vectors');
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}",pg_catalog;
    CREATE TABLE bg_jobs (id text primary key, tenant_id text not null, user_id text, type text not null, ref_id text, status text not null default 'queued', cursor text, error text, attempts integer not null default 0, lease_until bigint, created_at bigint not null, updated_at bigint not null, started_at bigint, finished_at bigint);`);
  // TODO(handoff): Qualify actual Qdrant generation/outbox triggers under 10-06 and
  // phase15; this fixture proves PostgreSQL document/chunk/vector RLS only. See
  // meta proposals/2026-09-08-platform-qc-remediation.md (JOB-02 vector propagation).
  for (const file of [
    '20260909090100_bg_job_lease_generation.sql',
    '20260909090300_job_effect_receipts.sql',
    '20260909090400_job_request_manifest.sql',
    '20260702120000_brains.sql',
  ]) {
    const ddl = readFileSync(
      new URL(`../../../supabase/migrations/${file}`, import.meta.url),
      'utf8',
    );
    await owner.unsafe(
      ddl
        .replaceAll('public.', `"${schema}".`)
        .replace('embedding vector(1536)', 'embedding extensions.vector(1536)')
        .replace('embedding vector_cosine_ops', 'embedding extensions.vector_cosine_ops'),
    );
  }
  // Later production declarations read by loadBrain; preserve the original
  // migration's FK/cascade/column/vector/RLS constraints above.
  await owner.unsafe(`ALTER TABLE brains ADD kind text NOT NULL DEFAULT 'focused', ADD include_all_sources boolean NOT NULL DEFAULT false, ADD agent_id text;
    GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;`);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  owner = harness.createConnection(schema);
  const ids = await Promise.all(
    [a, b].map(async (client) => (await client`select pg_backend_pid() as pid`)[0]!.pid),
  );
  expect(ids[0]).not.toBe(ids[1]);
  boundary.pool.mockImplementation(() => context.getStore() ?? a);
}, 20000);
beforeEach(async () => {
  await owner.unsafe(
    'DROP TRIGGER IF EXISTS reject_ready ON brain_documents; DROP TRIGGER IF EXISTS reject_enqueue ON bg_jobs',
  );
  await owner.unsafe('TRUNCATE bg_jobs,job_effects,brains CASCADE');
  await owner`insert into brains(id,org_id,name) values (${BRAIN},${ORG},'Synthetic KB')`;
  boundary.env.OPENROUTER_API_KEY = 'synthetic';
  boundary.env.OPENAI_API_KEY = '';
  boundary.audit.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => embeddingResponse(init)),
  );
});
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...outstanding]);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  if (owner) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness?.close();
});

describe('brain ingestion native effect ownership', () => {
  it('creates a revision atomically with its document and job, then publishes real vectors and progress', async () => {
    const created = await document();
    const before = await job(created.jobId);
    expect(JSON.parse(String(before.cursor)).__jobRequest.entityId).toBe(created.doc.id);
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).status).toBe('done');
    expect((await chunks(created.doc.id))[0]).toMatchObject({
      dimensions: 1536,
      chunk_text: created.doc.contentMd,
    });
    expect(await owner`select state from job_effects where kind='effect'`).toEqual([
      { state: 'committed' },
    ]);
    expect(JSON.parse(String((await job(created.jobId)).cursor)).brainIngest.phase).toBe(
      'complete',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(boundary.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ op: 'create', actor }),
    );
  });

  it('does not dispatch again after a response is lost before a durable receipt', async () => {
    const created = await document();
    vi.mocked(fetch).mockRejectedValue(new Error('synthetic lost response'));
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).status).toBe('failed');
    expect(await owner`select state from job_effects where kind='effect'`).toEqual([
      { state: 'admitted' },
    ]);
    await retry(created.jobId);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await job(created.jobId)).error).toContain('indeterminate');
    expect(await chunks(created.doc.id)).toHaveLength(0);
  });

  it('reingest while embedding is pending fences the old request and its returned vector', async () => {
    const created = await document();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => reingestDocument(scope(), BRAIN, created.doc.id, principal));
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect(await chunks(created.doc.id)).toHaveLength(0);
    expect(
      (await owner`select status from brain_documents where id=${created.doc.id}`)[0]!.status,
    ).toBe('pending');
    expect((await job(created.jobId)).status).toBe('failed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails a concurrent duplicate without repeating admission or poisoning the active original', async () => {
    const created = await document();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    await on(b, () => advanceJob(duplicate));
    expect((await job(duplicate)).error).toContain('indeterminate');
    expect(
      (await owner`select status from brain_documents where id=${created.doc.id}`)[0]!.status,
    ).toBe('ingesting');
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect((await job(created.jobId)).status).toBe('done');
    const original = await chunks(created.doc.id);
    await retry(duplicate);
    expect((await job(duplicate)).status).toBe('done');
    expect(JSON.parse(String((await job(duplicate)).cursor)).brainIngest.phase).toBe('complete');
    expect(await chunks(created.doc.id)).toEqual(original);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses all received batches after final publication rollback and keeps old chunks until commit', async () => {
    const content = 'x'.repeat(180000);
    const pieces = chunkText(content);
    expect(pieces.length).toBeGreaterThan(64);
    const created = await document(content);
    await owner`insert into brain_chunks(brain_id,document_id,org_id,seq,chunk_text) values (${BRAIN},${created.doc.id},${ORG},0,'old published chunk')`;
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
    const second = deferred<Response>();
    vi.mocked(fetch)
      .mockImplementationOnce(async (_url, init) => embeddingResponse(init))
      .mockImplementationOnce(() => second.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 2);
    expect((await chunks(created.doc.id)).map((row) => row.chunk_text)).toEqual([
      'old published chunk',
    ]);
    expect(JSON.parse(String((await job(created.jobId)).cursor)).brainIngest.receivedBatches).toBe(
      1,
    );
    second.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[1]![1]));
    await running;
    expect((await job(created.jobId)).error).toContain('publication failed');
    expect((await chunks(created.doc.id)).map((row) => row.chunk_text)).toEqual([
      'old published chunk',
    ]);
    expect(await owner`select state from job_effects where kind='effect' order by unit`).toEqual([
      { state: 'received' },
      { state: 'received' },
    ]);
    await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
    await retry(created.jobId);
    expect(fetch).toHaveBeenCalledTimes(2);
    const bodies = vi
      .mocked(fetch)
      .mock.calls.map(
        (call) => JSON.parse(String(call[1]?.body)) as { input: string[]; model: string },
      );
    expect(bodies.map((body) => body.input.length)).toEqual([64, pieces.length - 64]);
    expect(bodies.flatMap((body) => body.input)).toEqual(pieces);
    expect(bodies[0]!.model).toBe('openai/text-embedding-3-small');
    expect(await chunks(created.doc.id)).toHaveLength(pieces.length);
    expect((await job(created.jobId)).status).toBe('done');
    expect(JSON.parse(String((await job(created.jobId)).cursor)).brainIngest).toMatchObject({
      phase: 'complete',
      receivedBatches: 2,
      chunks: pieces.length,
    });
  });

  it('cancellation aborts caller waiting when the provider ignores abort, without publishing its late response', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const created = await document();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await owner`update bg_jobs set status='cancelled',lease_generation=lease_generation+1,lease_until=null where id=${created.jobId}`;
    await vi.advanceTimersByTimeAsync(20001);
    await running;
    expect(vi.mocked(fetch).mock.calls[0]![1]?.signal?.aborted).toBe(true);
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await job(created.jobId)).status).toBe('cancelled');
    expect(await chunks(created.doc.id)).toHaveLength(0);
    expect(await owner`select state from job_effects where kind='effect'`).toEqual([
      { state: 'admitted' },
    ]);
  });

  it('takeover cannot repeat an admitted call and the late previous owner cannot persist its response', async () => {
    const created = await document();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await owner`update bg_jobs set lease_until=0 where id=${created.jobId}`;
    await on(b, () => advanceJob(created.jobId));
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect((await job(created.jobId)).lease_generation).toBe(2);
    expect((await job(created.jobId)).error).toContain('indeterminate');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await chunks(created.doc.id)).toHaveLength(0);
    expect(await owner`select state from job_effects where kind='effect'`).toEqual([
      { state: 'admitted' },
    ]);
  });

  it('delete while embedding is pending revokes the request and does not resurrect the document', async () => {
    const created = await document();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    expect(
      await on(b, () =>
        removeDocument(scope(), BRAIN, created.doc.id.toUpperCase(), principal, actor),
      ),
    ).toBe(true);
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect(await owner`select id from brain_documents`).toHaveLength(0);
    expect(await chunks(created.doc.id)).toHaveLength(0);
    expect(await owner`select state from job_effects where kind='head'`).toEqual([
      { state: 'revoked' },
    ]);
  });

  it('rejects unversioned jobs before loading and explicit reingest provides a fresh bound recovery', async () => {
    const created = await document('legacy input');
    await owner`update bg_jobs set cursor=null where id=${created.jobId}`;
    await on(a, () => advanceJob(created.jobId));
    expect(fetch).not.toHaveBeenCalled();
    expect((await job(created.jobId)).error).toContain('explicit reingest');
    expect((await owner`select status from brain_documents`)[0]!.status).toBe('pending');
    await on(b, () => reingestDocument(scope(), BRAIN, created.doc.id, principal));
    const [next] = await owner`select id,cursor from bg_jobs where id<>${created.jobId}`;
    expect(JSON.parse(String(next!.cursor)).__jobRequest).toBeTruthy();
    await on(a, () => advanceJob(String(next!.id)));
    expect((await job(String(next!.id))).status).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('source mismatch is detected before provider work and cannot overwrite domain status', async () => {
    const created = await document();
    await owner`update brain_documents set content_md='replaced outside this request',status='pending' where id=${created.doc.id}`;
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).error).toContain('source changed');
    expect(fetch).not.toHaveBeenCalled();
    expect((await owner`select status from brain_documents`)[0]!.status).toBe('pending');
  });

  it('a changed provider configuration cannot consume received vectors as a different request', async () => {
    const created = await document();
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
    await on(a, () => advanceJob(created.jobId));
    await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
    boundary.env.OPENROUTER_API_KEY = '';
    boundary.env.OPENAI_API_KEY = 'synthetic-direct';
    await retry(created.jobId);
    expect((await job(created.jobId)).error).toContain('conflict');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await chunks(created.doc.id)).toHaveLength(0);
    expect(await owner`select state from job_effects where kind='effect'`).toEqual([
      { state: 'received' },
    ]);
  });

  it('creation failure rolls back document, head and enqueue together without recording a success audit', async () => {
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'synthetic enqueue rejected'; END $$;
      CREATE TRIGGER reject_enqueue BEFORE INSERT ON bg_jobs FOR EACH ROW EXECUTE FUNCTION fail_enqueue()`);
    await expect(document()).rejects.toThrow();
    expect(await owner`select id from brain_documents`).toHaveLength(0);
    expect(await owner`select id from job_effects`).toHaveLength(0);
    expect(await owner`select id from bg_jobs`).toHaveLength(0);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it('actual RLS denies cross-org reads and writes and a wrong brain cannot revoke a document request', async () => {
    const created = await document();
    const otherBrain = crypto.randomUUID();
    await owner`insert into brains(id,org_id,name) values (${otherBrain},${ORG},'Other brain')`;
    expect(
      await on(b, () => removeDocument(scope(), otherBrain, created.doc.id, principal, actor)),
    ).toBe(false);
    expect(await owner`select state from job_effects where kind='head'`).toEqual([
      { state: 'active' },
    ]);
    const rows = await on(b, () =>
      withOrgCore(scope(OTHER), (tx) => tx.execute(sql`select id from brain_documents`)),
    );
    expect(rows).toHaveLength(0);
    await expect(
      on(b, () =>
        withOrgCore(scope(OTHER), (tx) =>
          tx.execute(
            sql`insert into brain_chunks(brain_id,document_id,org_id,seq,chunk_text) values (${BRAIN},${created.doc.id},${ORG},0,'forbidden')`,
          ),
        ),
      ),
    ).rejects.toThrow();
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).status).toBe('done');
  });

  it('reingest during a blocked controlled URL fetch rejects old loaded content before embedding', async () => {
    const created = await document('', 'url');
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => reingestDocument(scope(), BRAIN, created.doc.id, principal));
    pending.resolve(new Response('<p>old URL content</p>'));
    await running;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await owner`select state from job_effects where kind='effect'`).toHaveLength(0);
    expect((await owner`select status from brain_documents`)[0]!.status).toBe('pending');
  });

  it('database constraints reject corrupt receipt vectors and valid received vectors remain reusable', async () => {
    const created = await document();
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
    await on(a, () => advanceJob(created.jobId));
    await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
    await expect(
      owner`update job_effects set result='[[1,2,3]]'::jsonb where kind='effect'`,
    ).rejects.toMatchObject({ code: '23514' });
    await retry(created.jobId);
    expect((await job(created.jobId)).status).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await chunks(created.doc.id)).toHaveLength(1);
  });

  it.each(['empty', 'disabled'] as const)(
    'preserves %s embedding compatibility with revision-bound atomic publication',
    async (mode) => {
      if (mode === 'disabled') boundary.env.OPENROUTER_API_KEY = '';
      const created = await document(mode === 'empty' ? '' : 'Unembedded synthetic content');
      await on(a, () => advanceJob(created.jobId));
      expect((await job(created.jobId)).status).toBe('done');
      expect(fetch).not.toHaveBeenCalled();
      expect(await owner`select state from job_effects where kind='effect'`).toHaveLength(0);
      const published = await chunks(created.doc.id);
      expect(published).toHaveLength(mode === 'empty' ? 0 : 1);
      if (mode === 'disabled') expect(published[0]!.dimensions).toBeNull();
      expect(JSON.parse(String((await job(created.jobId)).cursor)).brainIngest.phase).toBe(
        'complete',
      );
    },
  );

  it('canonicalizes database UUID identity before creating the source request', async () => {
    const doc = await on(a, () =>
      addDocument(
        scope(),
        BRAIN.toUpperCase(),
        { title: 'Canonical', sourceType: 'note', contentMd: 'UUID source' },
        principal,
        actor,
      ),
    );
    const [created] = await owner`select id from bg_jobs where ref_id=${doc.id}`;
    await on(a, () => advanceJob(String(created!.id)));
    expect((await job(String(created!.id))).status).toBe('done');
    expect(doc.brainId).toBe(BRAIN);
  });

  it('ordinary controlled URL loading retains manual redirects and embeds the loaded text', async () => {
    const created = await document('', 'url');
    vi.mocked(fetch)
      .mockImplementationOnce(
        async () => new Response(null, { status: 302, headers: { location: '/next' } }),
      )
      .mockImplementationOnce(
        async () => new Response('<script>omit</script><p>Loaded &amp; verified</p>'),
      );
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).status).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.slice(0, 2)
        .map((call) => call[1]?.redirect),
    ).toEqual(['manual', 'manual']);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]?.body)).input).toEqual([
      'Loaded & verified',
    ]);
    expect((await chunks(created.doc.id))[0]!.chunk_text).toBe('Loaded & verified');
  });

  it('deletion during URL loading prevents admission after the load completes', async () => {
    const created = await document('', 'url');
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => removeDocument(scope(), BRAIN, created.doc.id, principal, actor));
    pending.resolve(new Response('deleted request source'));
    await running;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await owner`select id from brain_documents`).toHaveLength(0);
    expect(await owner`select id from job_effects where kind='effect'`).toHaveLength(0);
  });

  it('a delayed mutable module duplicate with a shared64-chunk prefix cannot admit extra batches after another job publishes', async () => {
    const product = { code: 'S', name: '', category: null, unitPrice: '1', active: true };
    boundary.products.mockResolvedValue([product]);
    const scaffold = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    const first = { ...product, name: 'x'.repeat(3000 + 63 * 2700 - scaffold.length) };
    const extra = { ...product, code: 'L', name: 'y'.repeat(2700) };
    boundary.products.mockResolvedValue([first]);
    const short = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    boundary.products.mockResolvedValue([first, extra]);
    const longer = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    expect(chunkText(short)).toHaveLength(64);
    expect(chunkText(longer).slice(0, 64)).toEqual(chunkText(short));
    const doc = await on(a, () =>
      addDocument(
        scope(),
        BRAIN,
        { title: 'Mutable module', sourceType: 'module_ref', sourceRef: 'fin_products' },
        principal,
        actor,
      ),
    );
    const [createdJob] = await owner`select id from bg_jobs where ref_id=${doc.id}`;
    const created = { doc, jobId: String(createdJob!.id) };
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    const delayed = deferred<Array<typeof product>>();
    boundary.products.mockImplementationOnce(() => delayed.promise).mockResolvedValueOnce([first]);
    const second = on(b, () => advanceJob(duplicate));
    await until(() =>
      boundary.products.mock.results.some((result) => result.value === delayed.promise),
    );
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).status).toBe('done');
    const original = await chunks(created.doc.id);
    const countBeforeRelease = vi.mocked(fetch).mock.calls.length;
    delayed.resolve([first, extra]);
    await second;
    expect(fetch).toHaveBeenCalledTimes(countBeforeRelease);
    expect(await chunks(created.doc.id)).toEqual(original);
    expect(await owner`select unit,state from job_effects where kind='effect'`).toEqual([
      { unit: 'batch:0', state: 'committed' },
    ]);
  });

  it('an empty URL duplicate cannot publish over a different paid manifest already admitted', async () => {
    const created = await document('', 'url');
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    const pending = deferred<Response>();
    vi.mocked(fetch)
      .mockImplementationOnce(async () => new Response('paid document source'))
      .mockImplementationOnce(() => pending.promise)
      .mockImplementationOnce(async () => new Response(''));
    const original = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 2);
    await on(b, () => advanceJob(duplicate));
    expect((await job(duplicate)).error).toContain('conflict');
    expect((await owner`select status from brain_documents`)[0]!.status).toBe('ingesting');
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[1]![1]));
    await original;
    expect((await chunks(created.doc.id))[0]!.chunk_text).toBe('paid document source');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a disabled duplicate cannot replace a bound embedded manifest while its provider is pending', async () => {
    const created = await document();
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const original = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    const [head] = await owner`select manifest_hash from job_effects where kind='head'`;
    expect(head!.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    boundary.env.OPENROUTER_API_KEY = '';
    await on(b, () => advanceJob(duplicate));
    expect((await job(duplicate)).error).toContain('conflict');
    expect(await chunks(created.doc.id)).toHaveLength(0);
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await original;
    expect((await job(created.jobId)).status).toBe('done');
    expect(await owner`select manifest_hash from job_effects where kind='head'`).toEqual([head]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'empty'] as const)(
    'binds %s publication before SQL rollback and rejects a later embedded plan',
    async (mode) => {
      const created = await document(
        mode === 'empty' ? '' : 'disabled text',
        mode === 'empty' ? 'url' : 'note',
      );
      if (mode === 'disabled') boundary.env.OPENROUTER_API_KEY = '';
      else vi.mocked(fetch).mockResolvedValueOnce(new Response(''));
      await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
      await on(a, () => advanceJob(created.jobId));
      const [head] = await owner`select manifest_hash from job_effects where kind='head'`;
      expect(head!.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await owner`select id from job_effects where kind='effect'`).toHaveLength(0);
      await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
      boundary.env.OPENROUTER_API_KEY = 'synthetic';
      if (mode === 'empty') vi.mocked(fetch).mockResolvedValueOnce(new Response('now nonempty'));
      await retry(created.jobId);
      expect((await job(created.jobId)).error).toContain('conflict');
      expect(await chunks(created.doc.id)).toHaveLength(0);
      expect(await owner`select id from job_effects where kind='effect'`).toHaveLength(0);
      expect(await owner`select manifest_hash from job_effects where kind='head'`).toEqual([head]);
      expect(vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(
        0,
      );
    },
  );

  it('rejects an ambiguous unbound receipt revision and explicit reingest recovers without removing its history', async () => {
    const created = await document();
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
    await on(a, () => advanceJob(created.jobId));
    await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
    const old = await owner`select id,revision,state from job_effects where kind='effect'`;
    await owner`update job_effects set manifest_hash=null where kind='head'`;
    await retry(created.jobId);
    expect((await job(created.jobId)).error).toContain('conflict');
    expect(fetch).toHaveBeenCalledTimes(1);
    await on(a, () => reingestDocument(scope(), BRAIN, created.doc.id, principal));
    const [next] =
      await owner`select id from bg_jobs where ref_id=${created.doc.id} and id<>${created.jobId}`;
    await on(a, () => advanceJob(String(next!.id)));
    expect((await job(String(next!.id))).status).toBe('done');
    expect(await owner`select id,revision,state from job_effects where id=${old[0]!.id}`).toEqual(
      old,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a provider change between batches conflicts before another outbound request', async () => {
    const created = await document('x'.repeat(180000));
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      boundary.env.OPENROUTER_API_KEY = '';
      boundary.env.OPENAI_API_KEY = 'synthetic-direct';
      return embeddingResponse(init);
    });
    await on(a, () => advanceJob(created.jobId));
    expect((await job(created.jobId)).error).toContain('conflict');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      'https://openrouter.ai/api/v1/embeddings',
    );
    expect(await owner`select unit,state from job_effects where kind='effect'`).toEqual([
      { unit: 'batch:0', state: 'received' },
    ]);
    expect(await chunks(created.doc.id)).toHaveLength(0);
  });

  it('same-manifest duplicate retries finish with complete progress without new provider calls', async () => {
    const created = await document();
    await owner.unsafe(`CREATE OR REPLACE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_ready BEFORE UPDATE ON brain_documents FOR EACH ROW EXECUTE FUNCTION fail_ready()`);
    await on(a, () => advanceJob(created.jobId));
    await owner.unsafe('DROP TRIGGER reject_ready ON brain_documents');
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    await owner`update bg_jobs set status='queued',lease_until=null,error=null where id=${created.jobId}`;
    await Promise.all([on(a, () => advanceJob(created.jobId)), on(b, () => advanceJob(duplicate))]);
    for (const id of [created.jobId, duplicate]) {
      const current = await job(id);
      expect(current.status).toBe('done');
      expect(JSON.parse(String(current.cursor)).brainIngest.phase).toBe('complete');
    }
    expect(await chunks(created.doc.id)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a conflicting full module manifest before even its common-prefix batch can replay', async () => {
    const product = { code: 'S', name: '', category: null, unitPrice: '1', active: true };
    boundary.products.mockResolvedValue([product]);
    const scaffold = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    const first = { ...product, name: 'x'.repeat(3000 + 63 * 2700 - scaffold.length) };
    const extra = { ...product, code: 'L', name: 'y'.repeat(2700) };
    boundary.products.mockResolvedValue([first]);
    const short = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    boundary.products.mockResolvedValue([first, extra]);
    const long = await on(a, () => MODULE_SOURCES.fin_products.render(scope()));
    expect(chunkText(short)).toHaveLength(64);
    expect(chunkText(long).slice(0, 64)).toEqual(chunkText(short));
    const doc = await on(a, () =>
      addDocument(
        scope(),
        BRAIN,
        { title: 'Mutable', sourceType: 'module_ref', sourceRef: 'fin_products' },
        principal,
        actor,
      ),
    );
    const [created] = await owner`select id from bg_jobs where ref_id=${doc.id}`;
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created!.id}`;
    boundary.products.mockResolvedValueOnce([first]).mockResolvedValueOnce([first, extra]);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = on(a, () => advanceJob(String(created!.id)));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => advanceJob(duplicate));
    expect((await job(duplicate)).error).toContain('conflict');
    expect((await job(duplicate)).error).not.toContain('indeterminate');
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect((await job(String(created!.id))).status).toBe('done');
    expect(await chunks(doc.id)).toHaveLength(64);
    expect(await owner`select unit,state from job_effects where kind='effect'`).toEqual([
      { unit: 'batch:0', state: 'committed' },
    ]);
  });

  it('a delayed URL load failure after another duplicate publishes completes from canonical state', async () => {
    const created = await document('', 'url');
    const duplicate = crypto.randomUUID();
    await owner`insert into bg_jobs(id,tenant_id,type,ref_id,cursor,status,created_at,updated_at)
      select ${duplicate},tenant_id,type,ref_id,cursor,'queued',created_at,updated_at from bg_jobs where id=${created.jobId}`;
    const delayed = deferred<Response>();
    vi.mocked(fetch)
      .mockImplementationOnce(() =>
        delayed.promise.then(() => {
          throw new Error('synthetic delayed loading failure');
        }),
      )
      .mockResolvedValueOnce(new Response('published by the duplicate'));
    const original = on(a, () => advanceJob(created.jobId));
    await until(() => vi.mocked(fetch).mock.calls.length === 1);
    await on(b, () => advanceJob(duplicate));
    expect((await job(duplicate)).status).toBe('done');
    const canonical = await chunks(created.doc.id);
    delayed.resolve(new Response('unused'));
    await original;
    const final = await job(created.jobId);
    expect(final.status).toBe('done');
    expect(final.error).toBeNull();
    expect(JSON.parse(String(final.cursor)).brainIngest.phase).toBe('complete');
    expect(await chunks(created.doc.id)).toEqual(canonical);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(
      1,
    );
  });
});
