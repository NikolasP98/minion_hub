import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readReliabilityInsights } from './reliability-insights-read';

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:', intMode: 'number' });
  await client.batch(
    [
      'create table servers (id text primary key, tenant_id text not null)',
      `create table unified_events (
        id integer primary key,
        tenant_id text not null,
        server_id text not null,
        event text not null,
        category text not null,
        severity text not null,
        message text not null,
        occurred_at integer not null,
        agent_id text,
        metadata text
      )`,
      'create index idx_unified_events_tenant_server_time on unified_events(tenant_id,server_id,occurred_at)',
      "insert into servers(id,tenant_id) values ('legacy','org')",
    ],
    'write',
  );
});

afterEach(() => client.close());

it('uses the tenant/server/time index for the bounded source relation', async () => {
  const plan = await client.execute({
    sql: `explain query plan select event,category,severity,message,occurred_at
      from unified_events
      where tenant_id=? and server_id=? and occurred_at>=? and occurred_at<=?
      order by occurred_at,id limit ?`,
    args: ['org', 'legacy', 0, 100, 100_001],
  });
  expect(plan.rows.map((row) => String(row.detail)).join('\n')).toContain(
    'idx_unified_events_tenant_server_time',
  );
});

it('rejects a real cap-plus-one source relation without publishing truncated totals', async () => {
  await client.execute(`
    with recursive rows(n) as (
      values(1)
      union all select n+1 from rows where n<100001
    )
    insert into unified_events(
      id,tenant_id,server_id,event,category,severity,message,occurred_at,agent_id,metadata
    )
    select n,'org','legacy','tool.completed','tool','info','ok',1,null,null from rows
  `);
  const tx = await client.transaction('read');
  try {
    await expect(readReliabilityInsights(tx, 'legacy', { from: 0, to: 100 })).rejects.toThrow(
      /cap/,
    );
  } finally {
    tx.close();
  }
});
