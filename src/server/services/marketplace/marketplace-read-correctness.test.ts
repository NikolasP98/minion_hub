import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { marketplaceFileLoadState } from '$server/db/pg-marketplace-schema';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { marketplaceAgents } from '@minion-stack/db/pg';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { getCoreDb } from '$server/db/pg-client';
import { listMarketplaceAgents, populateAgentFiles } from '../marketplace.service';
import { listMarketplacePage, parseCatalogQuery } from './catalog-query';

const cache = vi.hoisted(() => ({ admitted: vi.fn() }));
vi.mock('@minion-stack/cache', async (original) => ({
  ...(await original<typeof import('@minion-stack/cache')>()),
  cached: (_key: string, _options: unknown, load: () => Promise<unknown>) => {
    cache.admitted(_key);
    return load();
  },
}));

const client = new PGlite();
const embedded = drizzle(client);
const db = embedded as unknown as ReturnType<typeof getCoreDb>;
beforeAll(async () => {
  for (const table of [marketplaceAgents, marketplaceFileLoadState]) {
    const definition = getTableConfig(table);
    await client.exec(
      `CREATE TABLE "${definition.name}" (${definition.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`).join(',')})`,
    );
  }
  await client.exec(
    'ALTER TABLE marketplace_file_load_state ALTER COLUMN next_eligible_at SET DEFAULT clock_timestamp()',
  );
});
afterAll(() => client.close());
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  cache.admitted.mockClear();
  await client.exec('TRUNCATE marketplace_agents, marketplace_file_load_state');
  await embedded.insert(marketplaceAgents).values(
    Array.from({ length: 140 }, (_, index) => ({
      id: `agent-${String(index).padStart(3, '0')}`,
      name: `Target ${index}`,
      role: 'Synthetic role',
      model: index % 3 === 0 ? 'Claude-Fixture' : 'GPT-Fixture',
      category: index % 2 ? 'engineering' : 'creative',
      tags: '["synthetic"]',
      description: 'Synthetic catalog record',
      version: '1',
      avatarSeed: `agent-${index}`,
      githubPath: `agents/agent-${index}`,
      installCount: index,
      syncedAt: new Date('2026-10-01T00:00:00Z'),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
      soulMd: 'Existing verified document',
      filesLoadedAt: null,
    })),
  );
});

it('intersects search and category before selecting the page', async () => {
  const rows = await listMarketplaceAgents(db, {
    category: 'engineering',
    search: 'Target',
    limit: 100,
  });
  expect(rows).toHaveLength(70);
  expect(rows.every((row) => row.category === 'engineering')).toBe(true);
});

it('returns the most popular records from the full catalog first', async () => {
  const rows = await listMarketplaceAgents(db);
  expect(rows).toHaveLength(50);
  expect(rows[0].id).toBe('agent-139');
  expect(rows.at(-1)?.id).toBe('agent-090');
});

it('does not erase verified documents or mark hydration complete after a provider outage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('synthetic outage')));
  await expect(populateAgentFiles(db, 'agent-001')).rejects.toThrow();
  const result = await client.query<{ soul_md: string; files_loaded_at: null }>(
    'SELECT soul_md, files_loaded_at FROM marketplace_agents WHERE id=$1',
    ['agent-001'],
  );
  expect(result.rows[0]).toEqual({ soul_md: 'Existing verified document', files_loaded_at: null });
});

it('filters featured, model and category before stable pagination and returns the full count', async () => {
  const filters = { category: 'engineering', model: 'CLAUDE', featured: true, limit: 2 };
  const a = await listMarketplacePage(db, filters);
  const b = await listMarketplacePage(db, { ...filters, offset: 2 });
  const c = await listMarketplacePage(db, { ...filters, offset: 4 });
  expect([a.total, b.total, c.total]).toEqual([6, 6, 6]);
  expect([...a.agents, ...b.agents, ...c.agents].map((row) => row.id)).toEqual([
    'agent-135',
    'agent-129',
    'agent-123',
    'agent-117',
    'agent-111',
    'agent-105',
  ]);
  const empty = await listMarketplacePage(db, { ...filters, offset: 100 });
  expect(empty).toMatchObject({ total: 6, agents: [] });
});

it('sorts newest and name over the entire population with deterministic id ties', async () => {
  await client.query('UPDATE marketplace_agents SET name=$1 WHERE id IN ($2,$3)', [
    'AAA',
    'agent-010',
    'agent-020',
  ]);
  const names = await listMarketplacePage(db, { sort: 'name', limit: 2 });
  expect(names.agents.map((row) => row.id)).toEqual(['agent-010', 'agent-020']);
  const latest = await listMarketplacePage(db, { sort: 'newest', limit: 2 });
  expect(latest.agents.map((row) => row.id)).toEqual(['agent-139', 'agent-138']);
});

it('searches wildcard characters and backslashes literally', async () => {
  const literal = '100%_\\special';
  await client.query('UPDATE marketplace_agents SET description=$1 WHERE id=$2', [
    literal,
    'agent-007',
  ]);
  const result = await listMarketplacePage(db, { search: literal });
  expect(result.agents.map((row) => row.id)).toEqual(['agent-007']);
  expect(result.total).toBe(1);
});

it('admits only six fixed first-page cache keys, bypassing arbitrary search, model, category and offset', async () => {
  for (const sort of ['popular', 'newest', 'name'] as const) {
    for (const featured of [false, true]) await listMarketplacePage(db, { sort, featured });
  }
  expect(cache.admitted).toHaveBeenCalledTimes(6);
  expect(new Set(cache.admitted.mock.calls.map(([key]) => key)).size).toBe(6);
  for (const filters of [
    { search: 'Target' },
    { model: 'GPT' },
    { category: 'creative' },
    { offset: 50 },
    { limit: 10 },
  ]) {
    await listMarketplacePage(db, filters);
  }
  expect(cache.admitted).toHaveBeenCalledTimes(6);
});

it.each([
  'limit=-1',
  'limit=0',
  'limit=101',
  'limit=NaN',
  'offset=-1',
  'offset=1e3',
  'offset=1000001',
  'offset=01',
  'sort=random',
  'featured=1',
  'search=a&search=b',
  'unknown=x',
])('rejects malformed public query %s', (query) => {
  expect(() => parseCatalogQuery(new URLSearchParams(query))).toThrow();
});

it('normalizes empty optional fields and rejects bounded string overflow', () => {
  expect(parseCatalogQuery(new URLSearchParams('search=%20%20&featured=false'))).toMatchObject({
    search: undefined,
    featured: false,
    sort: 'popular',
    limit: 50,
    offset: 0,
  });
  for (const [key, length] of [
    ['search', 257],
    ['category', 65],
    ['model', 129],
  ] as const) {
    expect(() => parseCatalogQuery(new URLSearchParams({ [key]: 'x'.repeat(length) }))).toThrow();
  }
});

it('publishes optional 404s and empty files atomically, and does not fetch a ready bundle twice', async () => {
  const fetcher = vi.fn(async (input: string) => {
    const path = new URL(input).pathname.split('/contents/')[1];
    if (path.endsWith('SKILLS.md')) return new Response('', { status: 404 });
    return Response.json({
      type: 'file',
      path,
      encoding: 'base64',
      content: Buffer.from(path.endsWith('USER.md') ? '' : 'Verified replacement').toString(
        'base64',
      ),
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await populateAgentFiles(db, 'agent-001');
  const { rows } = await client.query<{
    soul_md: string;
    user_md: string;
    skills_md: null;
    files_loaded_at: Date;
  }>('SELECT soul_md,user_md,skills_md,files_loaded_at FROM marketplace_agents WHERE id=$1', [
    'agent-001',
  ]);
  expect(rows[0]).toMatchObject({ soul_md: 'Verified replacement', user_md: '', skills_md: null });
  expect(rows[0].files_loaded_at).not.toBeNull();
  await populateAgentFiles(db, 'agent-001');
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('persists a failure cooldown without replacing any existing field', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('failure', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(populateAgentFiles(db, 'agent-001')).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(5);
  await expect(populateAgentFiles(db, 'agent-001')).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(5);
  const { rows } = await client.query(
    'SELECT soul_md,files_loaded_at FROM marketplace_agents WHERE id=$1',
    ['agent-001'],
  );
  expect(rows[0]).toEqual({ soul_md: 'Existing verified document', files_loaded_at: null });
});

it('first-load outage is retryable, while a catalog miss alone is null', async () => {
  const { getAgentWithFiles } = await import('./files');
  await client.query('UPDATE marketplace_agents SET soul_md=NULL WHERE id=$1', ['agent-001']);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('outage')));
  await expect(getAgentWithFiles(db, 'agent-001')).rejects.toMatchObject({
    code: 'provider_unavailable',
    retryAfterSeconds: 60,
  });
  await expect(getAgentWithFiles(db, 'missing-agent')).resolves.toBeNull();
});

it('one malformed sibling leaves the entire bundle untouched, then a due retry succeeds', async () => {
  let bad = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = new URL(input).pathname.split('/contents/')[1];
      return Response.json({
        type: 'file',
        path,
        encoding: 'base64',
        content:
          bad && path.endsWith('CONTEXT.md')
            ? 'bad!'
            : Buffer.from('Next bundle').toString('base64'),
      });
    }),
  );
  await expect(populateAgentFiles(db, 'agent-001')).rejects.toThrow();
  expect(
    (await client.query('SELECT soul_md FROM marketplace_agents WHERE id=$1', ['agent-001']))
      .rows[0],
  ).toEqual({ soul_md: 'Existing verified document' });
  await client.query(
    "UPDATE marketplace_file_load_state SET next_eligible_at=clock_timestamp()-interval '1 second'",
  );
  bad = false;
  await populateAgentFiles(db, 'agent-001');
  expect(
    (await client.query('SELECT soul_md FROM marketplace_agents WHERE id=$1', ['agent-001']))
      .rows[0],
  ).toEqual({ soul_md: 'Next bundle' });
});
