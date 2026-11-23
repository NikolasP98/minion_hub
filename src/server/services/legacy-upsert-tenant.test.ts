import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

vi.mock('@minion-stack/cache', () => ({
  cached: vi.fn(),
  invalidateTags: vi.fn(),
  keys: {},
  tags: { tenantDomain: () => [] },
}));

import { upsertAgents } from './agent.service';
import { upsertActivityBins } from './activity-bins.service';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const ctxFor = (tenantId: string) => ({ db: db as never, tenantId });

beforeEach(async () => {
  await client.executeMultiple(`
    DROP TABLE IF EXISTS agents; DROP TABLE IF EXISTS agent_activity_bins;
    CREATE TABLE agents (id TEXT NOT NULL, server_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      name TEXT, emoji TEXT, description TEXT, model TEXT, status TEXT DEFAULT 'active',
      raw_json TEXT NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY (id, server_id));
    CREATE TABLE agent_activity_bins (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
      server_id TEXT NOT NULL, agent_id TEXT NOT NULL, bin_ts INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX idx_bins ON agent_activity_bins (server_id, agent_id, bin_ts);
  `);
});

describe('legacy upserts leave another tenant row untouched', () => {
  test('agents', async () => {
    await upsertAgents(ctxFor('org-b'), 's1', [{ id: 'a1', name: 'B-name' }]);
    await upsertAgents(ctxFor('org-a'), 's1', [{ id: 'a1', name: 'hijacked' }]);
    const rows = (await client.execute('SELECT name, tenant_id FROM agents')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'B-name', tenant_id: 'org-b' });
  });

  test('agents: same tenant still updates', async () => {
    await upsertAgents(ctxFor('org-a'), 's1', [{ id: 'a1', name: 'one' }]);
    await upsertAgents(ctxFor('org-a'), 's1', [{ id: 'a1', name: 'two' }]);
    const rows = (await client.execute('SELECT name FROM agents')).rows;
    expect(rows[0]).toMatchObject({ name: 'two' });
  });

  test('activity bins', async () => {
    const bin = { agentId: 'a1', binTs: 1 };
    await upsertActivityBins(ctxFor('org-b'), 's1', [{ ...bin, count: 3 }]);
    await upsertActivityBins(ctxFor('org-a'), 's1', [{ ...bin, count: 99 }]);
    let rows = (await client.execute('SELECT count, tenant_id FROM agent_activity_bins')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, tenant_id: 'org-b' });
    await upsertActivityBins(ctxFor('org-b'), 's1', [{ ...bin, count: 7 }]);
    rows = (await client.execute('SELECT count FROM agent_activity_bins')).rows;
    expect(rows[0]).toMatchObject({ count: 7 });
  });
});
