import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({
  pool: vi.fn(),
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
import { getCoreDb } from '$server/db/pg-client';
import { advanceJob, cancelJobsByRef, enqueueJob } from './bg-runtime';
import {
  BRAIN_CORPUS_JOB_TYPE,
  ensureConversationReconcileJob,
  LEGACY_BRAIN_CORPUS_JOB_TYPE,
} from './brain-corpus-jobs.service';
import { BRAIN_BUSINESS_CORPUS_JOB_TYPE } from './brain-business-corpus-jobs.service';
import { BUSINESS_KNOWLEDGE_DOMAINS } from './brain-business-corpus.service';

type Client = ReturnType<typeof postgres>;
const context = new AsyncLocalStorage<Client>();
const schema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
const ORG = 'corpus-synthetic-alpha',
  OTHER = 'corpus-synthetic-beta';
const SALES_DOMAIN_INDEX = BUSINESS_KNOWLEDGE_DOMAINS.findIndex((domain) => domain.key === 'sales');
let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client, a: Client, b: Client;
const outstanding = new Set<Promise<unknown>>();
const releases = new Set<() => void>();
const fetchCalls = () => vi.mocked(fetch).mock.calls.length;

function on<T>(client: Client, work: () => Promise<T>) {
  const operation = context.run(client, work);
  outstanding.add(operation);
  void operation.then(
    () => outstanding.delete(operation),
    () => outstanding.delete(operation),
  );
  return operation;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  releases.add(() => resolve(undefined as T));
  return { promise, resolve };
}
async function until(check: () => boolean | Promise<boolean>, label = 'boundary') {
  const end = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Corpus fixture did not reach ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function embeddingResponse(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { input: string[] };
  return Response.json({
    data: body.input.map((_text, index) => ({
      index,
      embedding: Array.from({ length: 1536 }, (_, i) => (i === 0 ? index + 1 : 0.125)),
    })),
    usage: { prompt_tokens: body.input.length },
  });
}
/** pgvector is unavailable on this substrate: `vector(1536)` becomes a text
 * domain and ANN indexes are dropped. Vector storage semantics stay pending. */
function ddl(file: string) {
  return readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8')
    .replace('create extension if not exists vector;', '')
    .replaceAll('vector(1536)', 'vector')
    .replace(
      /create index if not exists \w+_embedding_hnsw\s+on public\.\w+ using hnsw \(embedding vector_cosine_ops\);/g,
      '',
    )
    .replaceAll('public.', `"${schema}".`);
}
async function message(
  input: {
    org?: string;
    channel?: string;
    account?: string;
    chat: string;
    content: string;
    at: string;
    direction?: string;
    messageId?: string;
  },
  client = owner,
) {
  await client`insert into messages(org_id,channel,account_id,chat_id,message_id,direction,content,sender_id,sender_name,occurred_at,created_at)
    values(${input.org ?? ORG},${input.channel ?? 'whatsapp'},${input.account ?? 'acct-1'},${input.chat},
      ${input.messageId ?? `mid-${crypto.randomUUID()}`},${input.direction ?? 'inbound'},${input.content},'+51900000001','Ada',${input.at}::timestamptz,${input.at}::timestamptz)`;
}
async function dirtyJob(
  conversations: { channel?: string; accountId: string; chatId: string; months: string[] }[],
  type: string = BRAIN_CORPUS_JOB_TYPE,
  tenantId = ORG,
) {
  return on(a, () =>
    enqueueJob({
      tenantId,
      type,
      refId: type === LEGACY_BRAIN_CORPUS_JOB_TYPE ? 'whatsapp:dirty' : 'conversations:dirty',
      cursor: {
        kind: 'dirty',
        conversations: conversations.map((conversation) =>
          type === LEGACY_BRAIN_CORPUS_JOB_TYPE
            ? {
                accountId: conversation.accountId,
                chatId: conversation.chatId,
                months: conversation.months,
              }
            : { channel: 'whatsapp', ...conversation },
        ),
        next: 0,
        failures: [],
      },
    }),
  );
}
async function businessJob(tenantId = ORG) {
  return on(a, () =>
    enqueueJob({
      tenantId,
      type: BRAIN_BUSINESS_CORPUS_JOB_TYPE,
      refId: 'business:reconcile',
      cursor: {
        domainIndex: SALES_DOMAIN_INDEX,
        domainCursor: null,
        processed: 0,
        changedChunks: 0,
        embeddedChunks: 0,
        failedDomains: 0,
      },
    }),
  );
}
async function salesOrder(humanId: string, description: string, org = ORG) {
  const [row] =
    await owner`insert into sales_orders(org_id,human_id,customer_name,description,quantity,unit_price,total,currency,status)
    values(${org},${humanId},'Ada Lovelace',${description},1,100,100,'PEN','confirmed') returning id`;
  return String(row!.id);
}
const run = (jobId: string, client = a) => on(client, () => advanceJob(jobId, 20_000));
async function job(id: string): Promise<{ status: string; error: string | null; cursor: unknown }> {
  const [row] = await owner`select status,error,cursor from bg_jobs where id=${id}`;
  return {
    status: String(row!.status),
    error: row!.error == null ? null : String(row!.error),
    cursor: row!.cursor ? JSON.parse(String(row!.cursor)) : null,
  };
}
async function retry(id: string, client = a) {
  await owner`update bg_jobs set status='queued',lease_until=null,error=null where id=${id}`;
  await run(id, client);
}
const documents = (org = ORG) =>
  owner`select external_id,status,content_hash from knowledge_documents where org_id=${org} order by external_id`;
const chunks = (org = ORG) =>
  owner`select document_id,chunk_key,content_hash,(embedding is not null) as embedded,embedding_model,left(embedding,12) as head
    from knowledge_chunks where org_id=${org} order by document_id,chunk_key`;
const sources = (org = ORG) =>
  owner`select connector,external_key,status,last_error,watermark from knowledge_sources where org_id=${org} order by connector,external_key`;
const units = () =>
  owner`select count(*)::int as total,count(first_published_at)::int as published from job_effect_units`;
const batches = () =>
  owner`select state,count(*)::int as count from job_effect_batches group by state order by state`;

beforeAll(async () => {
  harness = await openDisposablePostgres();
  owner = harness.owner;
  expect(harness.identity.database).toBe('minion_qc_corpus');
  const [vector] = await owner`select extversion from pg_extension where extname='vector'`;
  // Pending evidence, not a pass: no pgvector on this substrate (see ddl()).
  expect(vector).toBeUndefined();
  await owner.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}",pg_catalog;
    CREATE DOMAIN vector AS text;
    CREATE TABLE bg_jobs(id text primary key,tenant_id text not null,user_id text,type text not null,ref_id text,status text not null default 'queued',
      cursor text,error text,attempts integer not null default 0,lease_until bigint,created_at bigint not null,updated_at bigint not null,started_at bigint,finished_at bigint);
    CREATE TABLE organizations(id uuid primary key default gen_random_uuid());
    CREATE TABLE messages(id uuid primary key default gen_random_uuid(),org_id text not null,channel text not null,account_id text,chat_id text,message_id text,
      direction text not null default 'inbound',content text,sender_id text,sender_name text,occurred_at timestamptz,created_at timestamptz not null default now(),
      is_group boolean default false,is_bot boolean default false);
    CREATE TABLE parties(id uuid primary key default gen_random_uuid(),org_id text not null,type text not null default 'person',name text);
    CREATE TABLE crm_contacts(id uuid primary key default gen_random_uuid(),org_id text not null,party_id uuid,human_id text,display_name text,
      lifecycle_override text,source text not null default 'manual',deleted_at timestamptz);
    CREATE TABLE crm_contact_identities(org_id text not null,channel text not null,external_id text not null,contact_id uuid,handle text);
    CREATE TABLE crm_tags(id uuid primary key default gen_random_uuid(),org_id text not null,name text not null,position integer default 0);
    CREATE TABLE crm_contact_tags(org_id text not null,contact_id uuid not null,tag_id uuid not null);
    CREATE TABLE crm_activities(id uuid primary key default gen_random_uuid(),org_id text not null,contact_id uuid,kind text not null,occurred_at timestamptz not null default now());
    CREATE TABLE sales_orders(id uuid primary key default gen_random_uuid(),org_id text not null,human_id text,source_booking_id uuid,party_id uuid,crm_contact_id uuid,
      customer_name text,owner_id text,event_type_id uuid,product_id uuid,description text,quantity numeric,unit_price numeric,total numeric,currency text,status text,
      invoice_provider_ref text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());`);
  for (const file of [
    '20260909090100_bg_job_lease_generation.sql',
    '20260909090300_job_effect_receipts.sql',
    '20260909090400_job_request_manifest.sql',
    '20260909090500_job_effect_page_batches.sql',
    '20260702120000_brains.sql',
    '20260721210000_unified_brain_corpus.sql',
    '20260723010000_brain_vector_outbox.sql',
    '20260725030000_qdrant_owned_embeddings.sql',
    '20260725183500_qdrant_owned_receipts_reconcile.sql',
    '20260725193500_qdrant_ack_receipt_vector_release.sql',
    '20260725195000_qdrant_ack_active_generation_guard.sql',
  ])
    await owner.unsafe(ddl(file));
  // Later production declaration read by the Drizzle brains schema (20260703130000).
  await owner.unsafe('ALTER TABLE brains ADD agent_id text');
  // The Hub source calls these three RPCs with an explicit public. prefix; the
  // fixture forwards them into its private schema and removes them afterwards.
  await owner.unsafe(`
    CREATE FUNCTION public.brain_vector_app_generation_mode() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ select "${schema}".brain_vector_app_generation_mode() $$;
    CREATE FUNCTION public.brain_vector_app_source_state(p uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ select "${schema}".brain_vector_app_source_state(p) $$;
    CREATE FUNCTION public.brain_vector_app_source_pending_count(p uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ select "${schema}".brain_vector_app_source_pending_count(p) $$;
    GRANT EXECUTE ON FUNCTION public.brain_vector_app_generation_mode() TO app_ledger;
    GRANT EXECUTE ON FUNCTION public.brain_vector_app_source_state(uuid) TO app_ledger;
    GRANT EXECUTE ON FUNCTION public.brain_vector_app_source_pending_count(uuid) TO app_ledger;
    GRANT USAGE ON SCHEMA "${schema}" TO app_ledger;
    GRANT SELECT ON messages,parties,crm_contacts,crm_contact_identities,crm_tags,crm_contact_tags,crm_activities,sales_orders TO app_ledger;
    ALTER TABLE messages ENABLE ROW LEVEL SECURITY; ALTER TABLE messages FORCE ROW LEVEL SECURITY;
    CREATE POLICY messages_org ON messages TO app_ledger USING (org_id=current_setting('app.current_org_id',true));
    ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY; ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
    CREATE POLICY sales_orders_org ON sales_orders TO app_ledger USING (org_id=current_setting('app.current_org_id',true));
    CREATE FUNCTION qc_reject_progress() RETURNS trigger LANGUAGE plpgsql AS $$ begin
      if current_setting('qc.reject_progress',true)='1' and new.cursor is distinct from old.cursor then raise exception 'qc: progress write rejected'; end if;
      return new; end $$;
    CREATE TRIGGER qc_reject_progress BEFORE UPDATE ON bg_jobs FOR EACH ROW EXECUTE FUNCTION qc_reject_progress();`);
  a = harness.createConnection(schema);
  b = harness.createConnection(schema);
  owner = harness.createConnection(schema);
  const ids = await Promise.all(
    [a, b].map(async (client) => (await client`select pg_backend_pid() as pid`)[0]!.pid),
  );
  expect(ids[0]).not.toBe(ids[1]);
  const [restricted] =
    await owner`select rolsuper,rolbypassrls,has_table_privilege('app_ledger','bg_jobs','update') as job_update from pg_roles where rolname='app_ledger'`;
  expect(restricted).toEqual({ rolsuper: false, rolbypassrls: false, job_update: false });
  console.log(
    'QC_CORPUS_CATALOG',
    JSON.stringify({ version: harness.identity.version, schema, pgvector: null, restricted }),
  );
  boundary.pool.mockImplementation(() => context.getStore() ?? a);
}, 30_000);
beforeEach(async () => {
  await owner.unsafe(
    `TRUNCATE bg_jobs,job_effects,job_effect_pages,job_effect_batches,job_effect_units,brain_vector_outbox,
     knowledge_chunks,knowledge_documents,knowledge_sources,brain_sources,brains,messages,sales_orders,
     parties,crm_contacts,crm_contact_identities,crm_tags,crm_contact_tags,crm_activities CASCADE;
     UPDATE brain_vector_generations SET storage_mode='pgvector',enqueue_enabled=false;`,
  );
  delete process.env.BRAIN_VECTOR_STORAGE_MODE;
  boundary.env.OPENROUTER_API_KEY = 'synthetic';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => embeddingResponse(init)),
  );
});
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  await Promise.allSettled([...outstanding]);
  await a`select set_config('qc.reject_progress','',false)`;
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (owner) {
    await owner.unsafe(`DROP FUNCTION IF EXISTS public.brain_vector_app_generation_mode();
      DROP FUNCTION IF EXISTS public.brain_vector_app_source_state(uuid);
      DROP FUNCTION IF EXISTS public.brain_vector_app_source_pending_count(uuid);
      DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await harness?.close();
});

describe('conversation corpus native effect ownership', { timeout: 30_000 }, () => {
  it('publishes a dirty conversation with receipts, health and exact progress in one owned commit', async () => {
    await message({ chat: 'chat-1', content: 'July hello', at: '2026-07-10T10:00:00Z' });
    await message({
      chat: 'chat-1',
      content: 'August reply',
      at: '2026-08-02T10:00:00Z',
      direction: 'outbound',
    });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-1', months: [] }]);
    await run(id);
    expect((await job(id)).status).toBe('done');
    expect(await documents()).toEqual([
      expect.objectContaining({
        external_id: 'conversation:acct-1:chat-1:2026-07',
        status: 'ready',
      }),
      expect.objectContaining({
        external_id: 'conversation:acct-1:chat-1:2026-08',
        status: 'ready',
      }),
    ]);
    const stored = await chunks();
    expect(stored).toHaveLength(2);
    expect(
      stored.every((chunk) => chunk.embedded && chunk.embedding_model === 'text-embedding-3-small'),
    ).toBe(true);
    expect(fetchCalls()).toBe(1);
    expect(await units()).toEqual([{ total: 2, published: 2 }]);
    expect(await batches()).toEqual([{ state: 'received', count: 1 }]);
    expect(await sources()).toEqual([
      expect.objectContaining({
        connector: 'whatsapp',
        external_key: 'acct-1',
        status: 'ready',
        last_error: null,
      }),
    ]);
    expect(await owner`select count(*)::int as n from brain_sources`).toEqual([{ n: 1 }]);
    expect((await job(id)).cursor).toMatchObject({
      kind: 'dirty',
      next: 1,
      attempts: 0,
      failures: [],
    });
  });

  it('legacy WhatsApp and current job types share one semantic admission for the same conversation', async () => {
    await message({ chat: 'chat-2', content: 'shared admission', at: '2026-07-10T10:00:00Z' });
    const legacy = await dirtyJob(
      [{ accountId: 'acct-1', chatId: 'chat-2', months: ['2026-07'] }],
      LEGACY_BRAIN_CORPUS_JOB_TYPE,
    );
    const current = await dirtyJob([
      { accountId: 'acct-1', chatId: 'chat-2', months: ['2026-07'] },
    ]);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const first = run(legacy);
    await until(() => fetchCalls() === 1, 'legacy dispatch');
    await run(current, b);
    // The overlapping duplicate observes an admitted request without a durable
    // response: it stops without a second paid call and without any effect.
    expect((await job(current)).status).toBe('failed');
    expect(String((await job(current)).error)).toContain('indeterminate');
    expect(await documents()).toHaveLength(0);
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await first;
    expect((await job(legacy)).status).toBe('done');
    const published = await chunks();
    expect(published).toHaveLength(1);
    await retry(current, b);
    expect((await job(current)).status).toBe('done');
    expect(await chunks()).toEqual(published);
    expect(fetchCalls()).toBe(1);
    expect(await owner`select count(*)::int as n from job_effects where kind='head'`).toEqual([
      { n: 1 },
    ]);
  });

  it('dirty and reconcile scheduling of one conversation converge on one paid request and one revision', async () => {
    await message({ chat: 'chat-3', content: 'overlap', at: '2026-07-10T10:00:00Z' });
    const { jobId: reconcile } = await on(a, () => ensureConversationReconcileJob(ORG));
    const dirty = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-3', months: [] }]);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const first = run(reconcile);
    await until(() => fetchCalls() === 1, 'reconcile dispatch');
    await run(dirty, b);
    expect(String((await job(dirty)).error)).toContain('indeterminate');
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await first;
    expect((await job(reconcile)).status).toBe('done');
    await retry(dirty, b);
    expect((await job(dirty)).status).toBe('done');
    expect(fetchCalls()).toBe(1);
    expect(await documents()).toHaveLength(1);
    expect(await units()).toEqual([{ total: 1, published: 1 }]);
  });

  it('a taken-over job cannot publish, change source health or advance after its response arrives', async () => {
    await message({ chat: 'chat-4', content: 'taken over', at: '2026-07-10T10:00:00Z' });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-4', months: [] }]);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = run(id);
    await until(() => fetchCalls() === 1, 'dispatch');
    const before = await job(id);
    expect(before.status).toBe('running');
    await owner`update bg_jobs set lease_until=0,lease_generation=lease_generation+1 where id=${id}`;
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect(await documents()).toHaveLength(0);
    expect(await sources()).toEqual([
      expect.objectContaining({ external_key: 'acct-1', status: 'processing' }),
    ]);
    const after = await job(id);
    expect(after.status).toBe('running');
    expect(after.cursor).toEqual(before.cursor);
    expect(after.error).toBeNull();
    expect(await units()).toEqual([{ total: 1, published: 0 }]);
    // The next owner finds an admitted request whose response was never retained
    // under current ownership: indeterminate, never an automatic paid replay.
    await retry(id, b);
    expect(String((await job(id)).error)).toContain('indeterminate');
    expect(fetchCalls()).toBe(1);
    expect(await documents()).toHaveLength(0);
  });

  it('cancellation between batches fences later admission and stops the second response', async () => {
    // 65 single-chunk turns: two transport batches (64 + 1) for one document.
    for (let index = 0; index < 65; index += 1)
      await message({
        chat: 'chat-5',
        content: `${index}-${'x'.repeat(5000)}`,
        at: `2026-07-${String(1 + (index % 28)).padStart(2, '0')}T10:${String(index % 60).padStart(2, '0')}:00Z`,
      });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-5', months: [] }]);
    const second = deferred<Response>();
    vi.mocked(fetch)
      .mockImplementationOnce(async (_url, init) => embeddingResponse(init))
      .mockImplementationOnce(() => second.promise);
    const running = run(id);
    await until(() => fetchCalls() === 2, 'two batches dispatched');
    await until(
      async () => (await batches()).some((batch) => batch.state === 'received'),
      'first batch retained',
    );
    await on(b, () => cancelJobsByRef('conversations:dirty'));
    second.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[1]![1]));
    await running;
    expect((await job(id)).status).toBe('cancelled');
    expect(await documents()).toHaveLength(0);
    expect(await batches()).toEqual([
      { state: 'admitted', count: 1 },
      { state: 'received', count: 1 },
    ]);
    const replacement = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-5', months: [] }]);
    await run(replacement, b);
    expect(String((await job(replacement)).error)).toContain('indeterminate');
    expect(fetchCalls()).toBe(2);
    expect(await documents()).toHaveLength(0);
  });

  it('a lost provider response leaves an admitted receipt; retries never pay again', async () => {
    await message({ chat: 'chat-6', content: 'lost response', at: '2026-07-10T10:00:00Z' });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-6', months: [] }]);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic lost response'));
    await run(id);
    const failed = await job(id);
    expect(failed.status).toBe('failed');
    expect(String(failed.error)).toContain('whatsapp/acct-1/chat-6');
    expect(failed.cursor).toMatchObject({ next: 1, failures: [expect.stringContaining('chat-6')] });
    expect(await sources()).toEqual([
      expect.objectContaining({
        status: 'failed',
        last_error: expect.stringContaining('synthetic lost response'),
      }),
    ]);
    expect(await batches()).toEqual([{ state: 'admitted', count: 1 }]);
    const again = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-6', months: [] }]);
    await run(again, b);
    expect(String((await job(again)).error)).toContain('indeterminate');
    expect(fetchCalls()).toBe(1);
    expect(await documents()).toHaveLength(0);
  });

  it('an older prepared snapshot never publishes over a newer source and re-prepares from the ledger', async () => {
    await message({ chat: 'chat-7', content: 'first version', at: '2026-07-10T10:00:00Z' });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-7', months: [] }]);
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = run(id);
    await until(() => fetchCalls() === 1, 'dispatch');
    await message({ chat: 'chat-7', content: 'second version', at: '2026-07-11T10:00:00Z' });
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect((await job(id)).status).toBe('done');
    expect(fetchCalls()).toBe(2);
    const [published] = await chunks();
    expect(published).toBeDefined();
    const [text] = await owner`select chunk_text from knowledge_chunks`;
    expect(String(text!.chunk_text)).toContain('second version');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body)).input[0]).toContain(
      'second version',
    );
    expect(await owner`select count(*)::int as n from job_effects where kind='head'`).toEqual([
      { n: 1 },
    ]);
  });

  it('a rollback between publication and progress keeps received vectors; the retry publishes without paying', async () => {
    await message({ chat: 'chat-8', content: 'rollback', at: '2026-07-10T10:00:00Z' });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-8', months: [] }]);
    await a`select set_config('qc.reject_progress','1',false)`;
    await run(id);
    const failed = await job(id);
    expect(failed.status).toBe('failed');
    // Drizzle wraps the trigger's exception; the failure note names the rejected progress statement.
    expect(String(failed.error)).toContain('Failed query: update "bg_jobs"');
    expect(failed.cursor).toMatchObject({ next: 0 });
    expect(await documents()).toHaveLength(0);
    expect(await batches()).toEqual([{ state: 'received', count: 1 }]);
    expect(await units()).toEqual([{ total: 1, published: 0 }]);
    await a`select set_config('qc.reject_progress','',false)`;
    await retry(id);
    expect((await job(id)).status).toBe('done');
    expect(await documents()).toHaveLength(1);
    expect(await units()).toEqual([{ total: 1, published: 1 }]);
    expect(fetchCalls()).toBe(1);
  });

  it('reconcile tombstones deleted conversations, keeps verified-empty sources healthy and commits the final cursor', async () => {
    await message({ chat: 'chat-9', content: 'to be deleted', at: '2026-07-10T10:00:00Z' });
    const first = await on(a, () => ensureConversationReconcileJob(ORG));
    await run(first.jobId);
    expect((await job(first.jobId)).status).toBe('done');
    expect(await documents()).toHaveLength(1);
    await owner`delete from messages where chat_id='chat-9'`;
    await message({ chat: 'chat-10', content: 'still here', at: '2026-07-10T10:00:00Z' });
    const second = await on(a, () => ensureConversationReconcileJob(ORG));
    expect(second.created).toBe(true);
    await run(second.jobId);
    expect((await job(second.jobId)).status).toBe('done');
    expect(await documents()).toEqual([
      expect.objectContaining({
        external_id: 'conversation:acct-1:chat-10:2026-07',
        status: 'ready',
      }),
      expect.objectContaining({
        external_id: 'conversation:acct-1:chat-9:2026-07',
        status: 'deleted',
      }),
    ]);
    expect(
      await owner`select count(*)::int as n from knowledge_chunks c join knowledge_documents d on d.id=c.document_id where d.status='deleted'`,
    ).toEqual([{ n: 0 }]);
    expect(await sources()).toEqual([
      expect.objectContaining({ status: 'ready', last_error: null }),
    ]);
    expect(fetchCalls()).toBe(2);
    // An empty final page still commits deletion/health effects and its cursor.
    await owner`delete from messages`;
    const third = await on(a, () => ensureConversationReconcileJob(ORG));
    await run(third.jobId);
    expect((await job(third.jobId)).status).toBe('done');
    expect((await documents()).map((document) => document.status)).toEqual(['deleted', 'deleted']);
    expect(await owner`select count(*)::int as n from knowledge_chunks`).toEqual([{ n: 0 }]);
    expect(await sources()).toEqual([
      expect.objectContaining({ status: 'ready', last_error: null }),
    ]);
    expect(fetchCalls()).toBe(2);
  });

  it('Qdrant-owned mode publishes canonical text without any embedding call and rejects a mismatched active generation', async () => {
    process.env.BRAIN_VECTOR_STORAGE_MODE = 'qdrant';
    await owner`update brain_vector_generations set storage_mode='qdrant',enqueue_enabled=true`;
    await message({ chat: 'chat-11', content: 'qdrant owned', at: '2026-07-10T10:00:00Z' });
    const id = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-11', months: [] }]);
    await run(id);
    expect((await job(id)).status).toBe('done');
    expect(fetchCalls()).toBe(0);
    expect(await chunks()).toEqual([
      expect.objectContaining({ embedded: false, embedding_model: null }),
    ]);
    expect(await documents()).toEqual([expect.objectContaining({ status: 'ready' })]);
    // Hub's base outbox trigger ignores inserted text-only chunks; the serving
    // worker's replacement trigger (gateway repo) is not part of this fixture.
    expect(await owner`select count(*)::int as n from brain_vector_outbox`).toEqual([{ n: 0 }]);
    expect(await sources()).toEqual([expect.objectContaining({ status: 'queued' })]);
    expect(await batches()).toEqual([]);
    await owner`update brain_vector_generations set storage_mode='pgvector'`;
    await message({
      chat: 'chat-12',
      content: 'mismatched generation',
      at: '2026-07-10T10:00:00Z',
    });
    const mismatched = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-12', months: [] }]);
    await run(mismatched, b);
    expect(String((await job(mismatched)).error)).toContain(
      'requires one active Qdrant-owned vector generation',
    );
    expect(await documents()).toHaveLength(1);
    expect(await sources()).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect(fetchCalls()).toBe(0);
  });

  it('tenant scoping holds under forced RLS and the restricted role never touches bg_jobs', async () => {
    await message({ chat: 'chat-13', content: 'alpha only', at: '2026-07-10T10:00:00Z' });
    await message({
      org: OTHER,
      chat: 'chat-13',
      content: 'beta only',
      at: '2026-07-10T10:00:00Z',
    });
    const alpha = await dirtyJob([{ accountId: 'acct-1', chatId: 'chat-13', months: [] }]);
    const beta = await dirtyJob(
      [{ accountId: 'acct-1', chatId: 'chat-13', months: [] }],
      BRAIN_CORPUS_JOB_TYPE,
      OTHER,
    );
    await Promise.all([run(alpha), run(beta, b)]);
    expect((await job(alpha)).status).toBe('done');
    expect((await job(beta)).status).toBe('done');
    const [alphaText] = await owner`select chunk_text from knowledge_chunks where org_id=${ORG}`;
    const [betaText] = await owner`select chunk_text from knowledge_chunks where org_id=${OTHER}`;
    expect(String(alphaText!.chunk_text)).toContain('alpha only');
    expect(String(alphaText!.chunk_text)).not.toContain('beta only');
    expect(String(betaText!.chunk_text)).toContain('beta only');
    expect(
      await owner`select count(*)::int as n from job_effects where kind='head' and tenant_id=${ORG}`,
    ).toEqual([{ n: 1 }]);
    expect((await job(alpha)).cursor).toMatchObject({ next: 1 });
    expect(fetchCalls()).toBe(2);
  });
});

describe('business corpus native effect ownership', { timeout: 30_000 }, () => {
  it('two business jobs share one admission, publish the sales domain once and reconcile deletions', async () => {
    await salesOrder('SO-1', 'Serum package');
    await salesOrder('SO-2', 'Follow-up session');
    const first = await businessJob();
    const second = await businessJob();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = run(first);
    await until(() => fetchCalls() === 1, 'business dispatch');
    await run(second, b);
    expect(String((await job(second)).error)).toContain('indeterminate');
    expect((await job(second)).cursor).toMatchObject({
      domainIndex: SALES_DOMAIN_INDEX,
      failedDomains: 0,
    });
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    const done = await job(first);
    // Domains after sales have no synthetic tables: each is an ordinary,
    // current-owned failure with bounded accounting and committed progress.
    expect(done.status).toBe('failed');
    expect(String(done.error)).toContain('failed domain');
    const remaining = BUSINESS_KNOWLEDGE_DOMAINS.length - SALES_DOMAIN_INDEX - 1;
    expect(done.cursor).toMatchObject({
      domainIndex: BUSINESS_KNOWLEDGE_DOMAINS.length,
      failedDomains: remaining,
    });
    expect(await documents()).toEqual([
      expect.objectContaining({
        external_id: expect.stringMatching(/^sales_orders:/),
        status: 'ready',
      }),
      expect.objectContaining({
        external_id: expect.stringMatching(/^sales_orders:/),
        status: 'ready',
      }),
    ]);
    expect((await chunks()).every((chunk) => chunk.embedded)).toBe(true);
    const [sales] =
      await owner`select status,watermark from knowledge_sources where connector='hub-business' and external_key='sales'`;
    expect(sales).toEqual({ status: 'ready', watermark: { expectedDocuments: 2 } });
    const [pos] =
      await owner`select status,last_error from knowledge_sources where connector='hub-business' and external_key='pos'`;
    expect(pos).toMatchObject({
      status: 'failed',
      last_error: expect.stringContaining('pos_settings'),
    });
    await retry(second, b);
    expect(fetchCalls()).toBe(1);
    expect(await units()).toEqual([{ total: 2, published: 2 }]);
    await owner`delete from sales_orders where human_id='SO-2'`;
    const third = await businessJob();
    await run(third);
    // external_id carries a random uuid: compare the status multiset, not the order.
    expect((await documents()).map((document) => document.status).sort()).toEqual([
      'deleted',
      'ready',
    ]);
    const [after] =
      await owner`select watermark from knowledge_sources where connector='hub-business' and external_key='sales'`;
    expect(after).toEqual({ watermark: { expectedDocuments: 1 } });
    expect(fetchCalls()).toBe(1);
  });

  it('a stale business page cannot publish or advance over a record that changed after preparation', async () => {
    const id = await salesOrder('SO-3', 'original description');
    const first = await businessJob();
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const running = run(first);
    await until(() => fetchCalls() === 1, 'business dispatch');
    await owner`update sales_orders set description='changed description',updated_at=now() where id=${id}`;
    pending.resolve(embeddingResponse(vi.mocked(fetch).mock.calls[0]![1]));
    await running;
    expect(fetchCalls()).toBe(2);
    const [text] = await owner`select chunk_text from knowledge_chunks`;
    expect(String(text!.chunk_text)).toContain('changed description');
    expect(String(text!.chunk_text)).not.toContain('original description');
    expect((await job(first)).cursor).toMatchObject({
      domainIndex: BUSINESS_KNOWLEDGE_DOMAINS.length,
      attempts: 0,
    });
    expect(await owner`select count(*)::int as n from job_effects where kind='head'`).toEqual([
      { n: 1 },
    ]);
  });
});
