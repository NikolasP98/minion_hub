import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import {
  LATEST_ARCHITECTURE_HEARTBEAT_QUERY,
  readLatestArchitectureHeartbeatRows,
} from './architecture-heartbeat-read';

let client: Client;

beforeEach(async () => {
  client = createClient({ url: ':memory:', intMode: 'number' });
  await client.batch(
    [
      `create table gateway_heartbeats (
        id integer primary key,
        server_id text not null,
        captured_at integer not null,
        uptime_ms integer,
        active_sessions integer,
        memory_rss_mb real,
        channel_status_json text
      )`,
      'create index idx_gw_heartbeats_server_time on gateway_heartbeats(server_id,captured_at)',
    ],
    'write',
  );
});

afterEach(() => client.close());

describe('bounded latest architecture heartbeat reads', () => {
  it('uses the server/time index and reads one latest row from a large history', async () => {
    await client.execute(`
      with recursive history(n) as (
        values(1)
        union all select n+1 from history where n<50000
      )
      insert into gateway_heartbeats(
        id,server_id,captured_at,uptime_ms,active_sessions,memory_rss_mb
      )
      select n,'default-server',n,n,1,128 from history
    `);
    const plan = await client.execute({
      sql: `explain query plan ${LATEST_ARCHITECTURE_HEARTBEAT_QUERY}`,
      args: ['default-server'],
    });
    expect(plan.rows.map((row) => String(row.detail)).join('\n')).toContain(
      'idx_gw_heartbeats_server_time',
    );

    const tx = await client.transaction('read');
    try {
      await expect(readLatestArchitectureHeartbeatRows(tx, ['default-server'])).resolves.toEqual([
        expect.objectContaining({ serverId: 'default-server', capturedAt: 50_000 }),
      ]);
    } finally {
      tx.close();
    }
  });

  it('projects an oversized channel payload as an overflow marker without its bytes', async () => {
    const oversized = JSON.stringify({ channelAccounts: { whatsapp: 'x'.repeat(20_000) } });
    await client.execute({
      sql: `insert into gateway_heartbeats(
        id,server_id,captured_at,uptime_ms,active_sessions,memory_rss_mb,channel_status_json
      ) values(1,?,?,?,?,?,?)`,
      args: ['default-server', 1, 1, 1, 128, oversized],
    });
    const tx = await client.transaction('read');
    try {
      const rows = await readLatestArchitectureHeartbeatRows(tx, ['default-server']);
      expect(rows).toEqual([
        expect.objectContaining({ channelStatusJson: null, channelStatusOverflow: 1 }),
      ]);
      expect(JSON.stringify(rows)).not.toContain('x'.repeat(513));
    } finally {
      tx.close();
    }
  });

  it('rejects more than the static target budget without issuing a query', async () => {
    const tx = await client.transaction('read');
    try {
      await expect(
        readLatestArchitectureHeartbeatRows(tx, ['one', 'two', 'three', 'four']),
      ).rejects.toThrow(/target limit/);
    } finally {
      tx.close();
    }
  });
});
