import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { marketplaceAgents } from '@minion-stack/db/pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../../scripts/qc/disposable-postgres';
import { claimCatalogSync, publishCatalogPage, syncMarketplaceAgents } from './sync';
import { claimDocumentLoad, getAgentWithFiles, publishDocuments } from './files';
import { upsertMetadata } from './metadata';
import type { CatalogDb, MarketplaceAgentUpsert } from './types';

vi.mock('@minion-stack/cache', () => ({
  invalidateTags: vi.fn(),
  tags: { global: () => ['marketplace'] },
}));
let fixture: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: ReturnType<typeof fixture.createConnection>;
let a: ReturnType<typeof fixture.createConnection>;
let b: ReturnType<typeof fixture.createConnection>;
let dbA: CatalogDb;
let dbB: CatalogDb;
let serviceRoleCreated = false;
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const migration = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261003110000_marketplace_operations.sql',
    import.meta.url,
  ),
  'utf8',
);
const releases: (() => void)[] = [];
const pending: Promise<unknown>[] = [];
const metadata = (id: string): MarketplaceAgentUpsert => ({
  id,
  name: id,
  role: 'Synthetic',
  category: 'engineering',
  tags: [],
  description: 'Disposable catalog fixture',
  version: '1',
  avatarSeed: id,
  githubPath: `agents/${id}`,
});
const success = (id: string): PromiseFulfilledResult<MarketplaceAgentUpsert> => ({
  status: 'fulfilled',
  value: metadata(id),
});
const documents = { soulMd: 'new', identityMd: null, userMd: '', contextMd: null, skillsMd: null };
async function seed(id = 'agent-a') {
  await dbA.transaction((tx) => upsertMetadata(tx, metadata(id)));
}
async function syncClaim(db = dbA) {
  const claimed = await claimCatalogSync(db);
  if (!claimed.row || !claimed.token) throw new Error('Expected a real lease');
  return claimed;
}
async function fileClaim(db = dbA) {
  const claim = await claimDocumentLoad(db, 'agent-a');
  if (!('agent' in claim) || !claim.agent || !claim.token)
    throw new Error('Expected document lease');
  return { agent: claim.agent, token: claim.token };
}

beforeAll(async () => {
  fixture = await openDisposablePostgres();
  const roles = await fixture.owner`SELECT rolname FROM pg_roles WHERE rolname='service_role'`;
  if (!roles.length) {
    await fixture.owner`CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`;
    serviceRoleCreated = true;
  }
  await fixture.owner.unsafe(`CREATE SCHEMA "${schema}"`);
  owner = fixture.createConnection(schema);
  a = fixture.createConnection(schema);
  b = fixture.createConnection(schema);
  dbA = drizzle(a) as CatalogDb;
  dbB = drizzle(b) as CatalogDb;
  const table = getTableConfig(marketplaceAgents);
  await owner.unsafe(
    `CREATE TABLE marketplace_agents (${table.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${['created_at', 'updated_at', 'synced_at'].includes(column.name) ? ' DEFAULT clock_timestamp()' : column.name === 'install_count' ? ' DEFAULT 0' : ''}`).join(',')})`,
  );
  await owner.unsafe(migration.replaceAll('public.', `"${schema}".`));
  console.info('disposable marketplace PostgreSQL receipt', {
    ...fixture.identity,
    schema,
    schemaSha256: createHash('sha256').update(migration).digest('hex'),
    pidA: (await a`SELECT pg_backend_pid() AS pid`)[0].pid,
    pidB: (await b`SELECT pg_backend_pid() AS pid`)[0].pid,
  });
}, 30_000);
beforeEach(async () => {
  await owner`TRUNCATE marketplace_agents,marketplace_file_load_state,marketplace_sync_state CASCADE`;
  await owner`INSERT INTO marketplace_sync_state(id) VALUES ('catalog')`;
});
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.allSettled(pending.splice(0));
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (owner) await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  if (serviceRoleCreated) await fixture.owner`DROP ROLE service_role`;
  await fixture?.close();
});

describe('native marketplace lease and publication ownership', () => {
  it('uses distinct backends and denies browser and tenant roles operational-table writes', async () => {
    expect((await a`SELECT pg_backend_pid() AS pid`)[0].pid).not.toBe(
      (await b`SELECT pg_backend_pid() AS pid`)[0].pid,
    );
    for (const role of ['anon', 'authenticated', 'app_ledger'])
      for (const table of ['marketplace_sync_state', 'marketplace_file_load_state']) {
        const [permission] =
          await owner`SELECT has_table_privilege(${role},${`${schema}.${table}`},'SELECT,INSERT,UPDATE,DELETE') AS allowed`;
        expect(permission.allowed).toBe(false);
      }
    const flags =
      await owner`SELECT relrowsecurity FROM pg_class WHERE oid IN (${`${schema}.marketplace_sync_state`}::regclass,${`${schema}.marketplace_file_load_state`}::regclass)`;
    expect(flags.every((row) => row.relrowsecurity === true)).toBe(true);
  });
  it('rejects partial leases and invalid cursors using database constraints', async () => {
    await expect(
      owner`UPDATE marketplace_sync_state SET lease_token=${randomUUID()}`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(owner`UPDATE marketplace_sync_state SET next_index=1`).rejects.toMatchObject({
      code: '23514',
    });
    await seed();
    await expect(
      owner`INSERT INTO marketplace_file_load_state(agent_id,lease_until) VALUES ('agent-a',clock_timestamp())`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner`INSERT INTO marketplace_file_load_state(agent_id,verified_at) VALUES ('agent-a',clock_timestamp())`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner`INSERT INTO marketplace_file_load_state(agent_id,verified_digest) VALUES ('agent-a',${'a'.repeat(64)})`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      owner`INSERT INTO marketplace_file_load_state(agent_id,verified_at,verified_digest) VALUES ('agent-a',clock_timestamp(),'invalid')`,
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('allows exactly one simultaneous catalog claimant and a later expired-owner replacement', async () => {
    const claims = await Promise.all([claimCatalogSync(dbA), claimCatalogSync(dbB)]);
    expect(claims.filter((claim) => claim.token)).toHaveLength(1);
    expect(claims.filter((claim) => claim.result?.status === 'busy')).toHaveLength(1);
    const first = claims.find((claim) => claim.token)!;
    await owner`UPDATE marketplace_sync_state SET lease_until=clock_timestamp()-interval '1 second'`;
    const next = await syncClaim(dbB);
    expect(next.token).not.toBe(first.token);
  });
  it('rejects an expired catalog publisher without changing catalog or cursor', async () => {
    const first = await syncClaim();
    await owner`UPDATE marketplace_sync_state SET lease_until=clock_timestamp()-interval '1 second'`;
    const next = await syncClaim(dbB);
    await expect(
      publishCatalogPage(dbA, first.row, first.token, ['agent-a'], [success('agent-a')]),
    ).rejects.toThrow('ownership expired');
    expect(await owner`SELECT id FROM marketplace_agents`).toHaveLength(0);
    expect(
      (await owner`SELECT lease_token,next_index FROM marketplace_sync_state`)[0],
    ).toMatchObject({ lease_token: next.token, next_index: 0 });
  });
  it('rolls back every catalog write if database time expires ownership before final progress CAS', async () => {
    const claim = await syncClaim();
    await owner.unsafe(
      `CREATE FUNCTION expire_catalog() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE marketplace_sync_state SET lease_until=clock_timestamp()-interval '1 second'; RETURN NEW; END $$; CREATE TRIGGER expire_catalog AFTER INSERT ON marketplace_agents FOR EACH ROW EXECUTE FUNCTION expire_catalog()`,
    );
    try {
      await expect(
        publishCatalogPage(dbA, claim.row, claim.token, ['agent-a'], [success('agent-a')]),
      ).rejects.toThrow('ownership expired');
      expect(await owner`SELECT id FROM marketplace_agents`).toHaveLength(0);
      expect((await owner`SELECT next_index,synced FROM marketplace_sync_state`)[0]).toMatchObject({
        next_index: 0,
        synced: 0,
      });
    } finally {
      await owner`DROP TRIGGER expire_catalog ON marketplace_agents`;
      await owner`DROP FUNCTION expire_catalog()`;
    }
  });
  it('isolates a permanent row constraint failure while advancing successful siblings as partial', async () => {
    const claim = await syncClaim();
    await owner`ALTER TABLE marketplace_agents ADD CONSTRAINT synthetic_bad_row CHECK (id <> 'bad')`;
    try {
      const result = await publishCatalogPage(
        dbA,
        claim.row,
        claim.token,
        ['good', 'bad'],
        [success('good'), success('bad')],
      );
      expect(result).toMatchObject({
        synced: 1,
        failed: 1,
        status: 'partial',
        continuation: false,
        errors: ['bad: invalid_catalog_row'],
      });
      expect((await owner`SELECT id FROM marketplace_agents`).map((row) => row.id)).toEqual([
        'good',
      ]);
    } finally {
      await owner`ALTER TABLE marketplace_agents DROP CONSTRAINT synthetic_bad_row`;
    }
  });
  it('aborts the whole page on infrastructure errors instead of classifying them as bad metadata', async () => {
    const claim = await syncClaim();
    await owner.unsafe(
      `CREATE FUNCTION fail_catalog() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='bad' THEN RAISE EXCEPTION 'synthetic serialization' USING ERRCODE='40001'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_catalog BEFORE INSERT ON marketplace_agents FOR EACH ROW EXECUTE FUNCTION fail_catalog()`,
    );
    try {
      await expect(
        publishCatalogPage(
          dbA,
          claim.row,
          claim.token,
          ['good', 'bad'],
          [success('good'), success('bad')],
        ),
      ).rejects.toThrow();
      expect(await owner`SELECT id FROM marketplace_agents`).toHaveLength(0);
      expect((await owner`SELECT next_index,synced FROM marketplace_sync_state`)[0]).toMatchObject({
        next_index: 0,
        synced: 0,
      });
    } finally {
      await owner`DROP TRIGGER fail_catalog ON marketplace_agents`;
      await owner`DROP FUNCTION fail_catalog()`;
    }
  });
  it('resumes a multi-page snapshot and keeps final completion distinct from a failed new listing', async () => {
    const dirs = Array.from({ length: 30 }, (_, i) => `agent-${i}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = new URL(input).pathname.split('/contents/')[1];
        if (path === 'agents')
          return Response.json(dirs.map((name) => ({ type: 'dir', name, path: `agents/${name}` })));
        const id = path.split('/')[1];
        return Response.json({
          type: 'file',
          path,
          encoding: 'base64',
          content: Buffer.from(JSON.stringify(metadata(id))).toString('base64'),
        });
      }),
    );
    expect(await syncMarketplaceAgents(dbA, false)).toMatchObject({
      status: 'running',
      synced: 25,
      continuation: true,
    });
    expect(await syncMarketplaceAgents(dbB, false)).toMatchObject({
      status: 'complete',
      synced: 30,
      continuation: false,
    });
    expect(await syncMarketplaceAgents(dbA, false)).toMatchObject({ status: 'not_due' });
    await owner`UPDATE marketplace_sync_state SET next_eligible_at=clock_timestamp()-interval '1 second'`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private-body', { status: 503 })),
    );
    expect(await syncMarketplaceAgents(dbA, false)).toMatchObject({ status: 'failed', synced: 0 });
    expect(
      (
        await owner`SELECT last_synced,last_failed,completed_at,directories FROM marketplace_sync_state`
      )[0],
    ).toMatchObject({ last_synced: 30, last_failed: 0, directories: [] });
  });
  it('recognizes a committed catalog page after its database response is lost', async () => {
    const claim = await syncClaim();
    const wrapped = Object.create(dbA) as CatalogDb;
    wrapped.transaction = (async (...args: Parameters<CatalogDb['transaction']>) => {
      await dbA.transaction(...args);
      throw new Error('synthetic lost response');
    }) as CatalogDb['transaction'];
    expect(
      await publishCatalogPage(wrapped, claim.row, claim.token, ['agent-a'], [success('agent-a')]),
    ).toMatchObject({ status: 'complete', synced: 1 });
    expect(await owner`SELECT id FROM marketplace_agents`).toHaveLength(1);
  });
  it('serializes document claims across backends and rejects an expired file publisher', async () => {
    await seed();
    const first = await fileClaim();
    expect(await claimDocumentLoad(dbB, 'agent-a')).toHaveProperty('unavailable');
    await owner`UPDATE marketplace_file_load_state SET lease_until=clock_timestamp()-interval '1 second'`;
    const next = await fileClaim(dbB);
    await expect(publishDocuments(dbA, first.agent, first.token, documents)).rejects.toThrow(
      'ownership expired',
    );
    expect(
      (await owner`SELECT files_loaded_at FROM marketplace_agents`)[0].files_loaded_at,
    ).toBeNull();
    await publishDocuments(dbB, next.agent, next.token, documents);
    expect((await owner`SELECT soul_md FROM marketplace_agents`)[0].soul_md).toBe('new');
  });
  it('invalidates changed metadata without erasing old documents or letting a stale worker overwrite them', async () => {
    await seed();
    const first = await fileClaim();
    await publishDocuments(dbA, first.agent, first.token, documents);
    await dbB.transaction((tx) => upsertMetadata(tx, { ...metadata('agent-a'), version: '2' }));
    const row = (await owner`SELECT soul_md,files_loaded_at,version FROM marketplace_agents`)[0];
    expect(row).toMatchObject({ soul_md: 'new', files_loaded_at: null, version: '2' });
    await expect(
      publishDocuments(dbA, first.agent, first.token, { ...documents, soulMd: 'stale' }),
    ).rejects.toThrow('ownership expired');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('outage')));
    expect(await getAgentWithFiles(dbA, 'agent-a')).toMatchObject({
      documentState: 'stale',
      soulMd: 'new',
      version: '2',
    });
  });
  it('rolls back document fields and loaded marker when lease expires before final publication CAS', async () => {
    await seed();
    const claim = await fileClaim();
    await owner.unsafe(
      `CREATE FUNCTION expire_documents() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE marketplace_file_load_state SET lease_until=clock_timestamp()-interval '1 second'; RETURN NEW; END $$; CREATE TRIGGER expire_documents AFTER UPDATE OF files_loaded_at ON marketplace_agents FOR EACH ROW EXECUTE FUNCTION expire_documents()`,
    );
    try {
      await expect(publishDocuments(dbA, claim.agent, claim.token, documents)).rejects.toThrow(
        'ownership expired',
      );
      expect(
        (await owner`SELECT soul_md,files_loaded_at FROM marketplace_agents`)[0],
      ).toMatchObject({ soul_md: null, files_loaded_at: null });
    } finally {
      await owner`DROP TRIGGER expire_documents ON marketplace_agents`;
      await owner`DROP FUNCTION expire_documents()`;
    }
  });
  it('bounds lock contention while preserving the actual lock owner', async () => {
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    releases.push(release);
    const holding = a.begin(async (tx) => {
      await tx`SELECT id FROM marketplace_sync_state FOR UPDATE`;
      acquired();
      await held;
    });
    pending.push(holding);
    await ready;
    const started = Date.now();
    await expect(claimCatalogSync(dbB)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(7000);
    release();
    await holding;
    expect((await owner`SELECT lease_token FROM marketplace_sync_state`)[0].lease_token).toBeNull();
  });
  it('invalidates legacy successful markers before treating any historical bundle as installable', async () => {
    await seed();
    await owner`UPDATE marketplace_agents SET files_loaded_at=clock_timestamp(),soul_md='partial legacy bundle'`;
    // Execute the exact migration transition against pre-upgrade content. The
    // CREATE statements were already exercised once above in this isolated schema.
    const transition = migration.match(
      /UPDATE public\.marketplace_agents SET files_loaded_at = NULL WHERE files_loaded_at IS NOT NULL;/,
    )?.[0];
    expect(transition).toBeDefined();
    await owner.unsafe(transition!.replaceAll('public.', `"${schema}".`));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('outage')));
    expect(await getAgentWithFiles(dbA, 'agent-a')).toMatchObject({
      documentState: 'stale',
      soulMd: 'partial legacy bundle',
      filesLoadedAt: null,
    });
  });
  it('rejects legacy loaded markers and changed bytes written after the new verifier publishes', async () => {
    await seed('legacy-metadata');
    await owner`UPDATE marketplace_agents SET files_loaded_at=clock_timestamp(),soul_md='legacy' WHERE id='legacy-metadata'`;
    await dbA.transaction((tx) =>
      upsertMetadata(tx, { ...metadata('legacy-metadata'), version: '2' }),
    );
    expect(
      (
        await owner`SELECT version,files_loaded_at FROM marketplace_agents WHERE id='legacy-metadata'`
      )[0],
    ).toMatchObject({ version: '2', files_loaded_at: null });
    expect(await claimDocumentLoad(dbB, 'legacy-metadata')).toMatchObject({ verified: false });
    expect(
      (
        await owner`SELECT verified_at,verified_digest FROM marketplace_file_load_state WHERE agent_id='legacy-metadata'`
      )[0],
    ).toEqual({ verified_at: null, verified_digest: null });
    await seed();
    await owner`UPDATE marketplace_agents SET files_loaded_at=clock_timestamp(),soul_md='legacy partial'`;
    const claimed = await fileClaim(); // A legacy marker alone cannot bypass verification.
    await publishDocuments(dbA, claimed.agent, claimed.token, documents);
    expect(await claimDocumentLoad(dbB, 'agent-a')).toHaveProperty('ready');
    // An old isolate can still publish after migration, even for the same version/path.
    await owner`UPDATE marketplace_agents SET files_loaded_at=clock_timestamp(),soul_md='legacy overwrite'`;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('outage')));
    expect(await getAgentWithFiles(dbB, 'agent-a')).toMatchObject({
      documentState: 'stale',
      soulMd: 'legacy overwrite',
    });
    expect(
      (await owner`SELECT verified_digest FROM marketplace_file_load_state WHERE agent_id='agent-a'`)[0].verified_digest,
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
