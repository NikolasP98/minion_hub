import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import type { CoreCtx } from '$server/auth/core-ctx';
import { stkItems } from '$server/db/pg-schema/stock';
import { schedEventTypes, schedEventTypeResources } from '$server/db/pg-scheduling-schema';

// Actual production services and PostgreSQL transactions; authorization has its
// separate native lane. This schema contains synthetic rows only.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(fn),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));
import { updateItem, archiveItems } from './stock.service';
import { upsertEventType } from './scheduling.service';
import { syncEventTypeFromProduct } from './scheduling-catalog-sync';
import { StaleWriteError } from './errors';

const databaseUrl = testDatabaseUrl();
if (!databaseUrl || !process.env.REQUIRE_QA_NATIVE_POSTGRES)
  throw new Error('Design durability requires the marked native PostgreSQL lane');
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))
  throw new Error('Design durability fixture requires loopback PostgreSQL');
const schema = `design_durability_${process.pid}_${Date.now()}`;
const owner = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const client = postgres(databaseUrl, { max: 4, connection: { search_path: schema } });
const db = drizzle(client);
const ctx = {
  db: db as unknown as CoreCtx['db'],
  tenantId: '10000000-0000-4000-8000-000000000001',
};
const id = '20000000-0000-4000-8000-000000000001';
const resource = '30000000-0000-4000-8000-000000000001';
const rejectedResource = '30000000-0000-4000-8000-000000000002';
// Ahead of wall clock: forces the same-ms monotonic branch, not a lucky slow test.
const token = new Date('2099-01-01T00:00:00.000Z');
const input = { slug: 'service', title: 'Updated', length: 30, resourceIds: [resource] };

beforeAll(async () => {
  await owner.unsafe(`CREATE SCHEMA "${schema}"`);
  for (const table of [stkItems, schedEventTypes, schedEventTypeResources]) {
    const config = getTableConfig(table);
    await client.unsafe(
      `CREATE TABLE "${config.name}" (${config.columns.map((column) => `"${column.name}" ${column.getSQLType()}`).join(',')})`,
    );
  }
  await client.unsafe(
    `ALTER TABLE sched_event_type_resources ADD CHECK (resource_id <> '${rejectedResource}')`,
  );
});
afterAll(async () => {
  await client.end();
  await owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await owner.end();
});
beforeEach(async () => {
  await client`TRUNCATE stk_items, sched_event_types, sched_event_type_resources`;
  await client`INSERT INTO stk_items (id,org_id,name,code,uom,updated_at) VALUES (${id},${ctx.tenantId},'Original','SKU','ea',${token.toISOString()})`;
  await client`INSERT INTO sched_event_types (id,org_id,slug,title,length,active,updated_at) VALUES (${id},${ctx.tenantId},'service','Original',30,true,${token.toISOString()})`;
  await client`INSERT INTO sched_event_type_resources (org_id,event_type_id,resource_id) VALUES (${ctx.tenantId},${id},${resource})`;
});

describe('design durability native writes', () => {
  it('admits exactly one competing stock writer and advances a same-ms token', async () => {
    const results = await Promise.allSettled([
      updateItem(ctx, id, { name: 'A' }, token),
      updateItem(ctx, id, { name: 'B' }, token),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(StaleWriteError);
    const [row] = await client`SELECT name,updated_at FROM stk_items WHERE id=${id}`;
    expect(['A', 'B']).toContain(row.name);
    expect(new Date(row.updated_at).getTime()).toBe(token.getTime() + 1);
  });
  it('rejects stale event resources and returns the token of its actual update', async () => {
    let returned: Date | undefined;
    await upsertEventType(ctx, input, id, token, (value) => {
      returned = value;
    });
    expect(returned?.getTime()).toBe(token.getTime() + 1);
    await expect(
      upsertEventType(ctx, { ...input, resourceIds: [] }, id, token),
    ).rejects.toBeInstanceOf(StaleWriteError);
    const links =
      await client`SELECT resource_id FROM sched_event_type_resources WHERE event_type_id=${id}`;
    expect(links.map((row) => row.resource_id)).toEqual([resource]);
  });
  it('rolls back the row and links when secondary resource replacement fails', async () => {
    await expect(
      upsertEventType(ctx, { ...input, resourceIds: [rejectedResource] }, id, token),
    ).rejects.toThrow();
    const [row] = await client`SELECT title,updated_at FROM sched_event_types WHERE id=${id}`;
    expect(row.title).toBe('Original');
    expect(new Date(row.updated_at).getTime()).toBe(token.getTime());
    const links =
      await client`SELECT resource_id FROM sched_event_type_resources WHERE event_type_id=${id}`;
    expect(links.map((row) => row.resource_id)).toEqual([resource]);
  });
  it('invalidates old tokens for archive and catalog authoritative writers', async () => {
    await archiveItems(ctx, [id], true);
    await expect(updateItem(ctx, id, { name: 'stale' }, token)).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    await client`UPDATE sched_event_types SET product_id=${id} WHERE id=${id}`;
    await syncEventTypeFromProduct(ctx, { id, name: 'Catalog', active: false, kind: 'service' });
    await expect(upsertEventType(ctx, input, id, token)).rejects.toBeInstanceOf(StaleWriteError);
    const [row] = await client`SELECT title,updated_at FROM sched_event_types WHERE id=${id}`;
    expect(row.title).toBe('Catalog');
    expect(new Date(row.updated_at).getTime()).toBe(token.getTime() + 1);
  });
  it('rejects foreign and missing event types before any link mutation', async () => {
    await expect(
      upsertEventType({ ...ctx, tenantId: 'foreign' }, input, id, token),
    ).rejects.toThrow('not found');
    await expect(upsertEventType(ctx, input, rejectedResource, token)).rejects.toThrow('not found');
    expect(await client`SELECT resource_id FROM sched_event_type_resources`).toHaveLength(1);
  });
});
