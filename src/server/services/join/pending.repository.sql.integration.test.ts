import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: boundary.pool }));
import {
  admitPendingRequest,
  readOwnPendingRequests,
  readOwnPendingRequestForOrganization,
  type PendingRequestTables,
} from './pending.repository';

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let db: ReturnType<typeof postgres>;
const schema = `qc_job_stock_join_${randomUUID().replaceAll('-', '')}`;
const tables: PendingRequestTables = {
  requests: `${schema}.join_request`,
  organizations: `${schema}.organizations`,
};
const who = {
  id: 'applicant-a',
  supabaseId: randomUUID(),
  email: 'a@example.test',
  displayName: 'Applicant A',
};
const other = {
  id: 'applicant-b',
  supabaseId: randomUUID(),
  email: 'b@example.test',
  displayName: 'Private applicant',
};

beforeAll(async () => {
  harness = await openDisposablePostgres();
  db = harness.owner;
  boundary.pool.mockReturnValue(db);
  await db`create schema ${db(schema)}`;
  await db`create table ${db(tables.organizations)} (id text primary key,name text not null)`;
  await db`create table ${db(tables.requests)} (
    id uuid primary key default gen_random_uuid(),supabase_id uuid not null,user_id text not null,
    email text not null,display_name text,message text,status text not null default 'pending',
    organization_id text not null,requested_role text not null default 'user',
    created_at timestamptz not null default now())`;
  await db`create unique index on ${db(tables.requests)} (user_id,organization_id) where status='pending'`;
});
beforeEach(async () => {
  await db`truncate ${db(tables.requests)},${db(tables.organizations)}`;
  await db`insert into ${db(tables.organizations)} (id,name) values ('org-a','Workspace A'),('org-b','Workspace B')`;
});
afterAll(async () => {
  if (db) await db`drop schema if exists ${db(schema)} cascade`;
  await harness?.close();
});

describe('pending join identity on PostgreSQL', () => {
  it('creates independent org requests and retries only the exact target', async () => {
    const a = await admitPendingRequest(who, 'org-a', 'first', tables);
    const b = await admitPendingRequest(who, 'org-b', 'second', tables);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.request.id).not.toBe(b.request.id);
    expect(await admitPendingRequest(who, 'org-b', 'retry', tables)).toEqual({
      request: b.request,
      created: false,
    });
    const rows = await db`select message from ${db(tables.requests)} where id=${b.request.id}`;
    expect(rows[0].message).toBe('second');
  });
  it('admits one creator across concurrent retries and returns the same receipt', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => admitPendingRequest(who, 'org-a', undefined, tables)),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.request.id)).size).toBe(1);
    expect(await db`select id from ${db(tables.requests)}`).toHaveLength(1);
  });
  it('does not substitute another applicant request in the same organization', async () => {
    const theirs = await admitPendingRequest(other, 'org-a', 'private note', tables);
    const own = await admitPendingRequest(who, 'org-a', undefined, tables);
    expect(own.created).toBe(true);
    expect(own.request.id).not.toBe(theirs.request.id);
  });
  it('returns explicit zero one and many own pending states without private fields', async () => {
    await admitPendingRequest(other, 'org-a', 'private note', tables);
    expect(await readOwnPendingRequests(who.id, tables)).toEqual({
      kind: 'none',
      requests: [],
      hasMore: false,
    });
    const a = await admitPendingRequest(who, 'org-a', 'my note', tables);
    const one = await readOwnPendingRequests(who.id, tables);
    expect(one.kind).toBe('one');
    expect(one.requests).toEqual([
      { id: a.request.id, organizationName: 'Workspace A', createdAt: expect.any(String) },
    ]);
    await admitPendingRequest(who, 'org-b', undefined, tables);
    const many = await readOwnPendingRequests(who.id, tables);
    expect(many.kind).toBe('many');
    expect(many.requests.map((r) => r.organizationName)).toEqual(['Workspace A', 'Workspace B']);
    expect(JSON.stringify(many)).not.toMatch(
      /private|email|supabase|message|requested_role|user_id/,
    );
  });
  it('selects pending identity only for the exact applicant and current target organization', async () => {
    const a = await admitPendingRequest(who, 'org-a', undefined, tables);
    await admitPendingRequest(other, 'org-b', undefined, tables);
    expect(await readOwnPendingRequestForOrganization(who.id, 'org-b', tables)).toBeNull();
    expect(await readOwnPendingRequestForOrganization(who.id, 'org-a', tables)).toEqual(a.request);
    const b = await admitPendingRequest(who, 'org-b', undefined, tables);
    expect(await readOwnPendingRequestForOrganization(who.id, 'org-b', tables)).toEqual(b.request);
    await db`update ${db(tables.requests)} set status='denied' where id=${b.request.id}`;
    expect(await readOwnPendingRequestForOrganization(who.id, 'org-b', tables)).toBeNull();
  });
  it('reports overflow after fifty requests without selecting an arbitrary organization', async () => {
    await db`insert into ${db(tables.requests)} (supabase_id,user_id,email,organization_id)
      select ${who.supabaseId}::uuid,${who.id},${who.email},'org-' || n::text from generate_series(1,51) n`;
    const result = await readOwnPendingRequests(who.id, tables);
    expect(result.kind).toBe('many');
    expect(result.requests).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.requests.every((r) => r.organizationName === 'Workspace')).toBe(true);
  });
  it('resolved requests neither appear pending nor suppress a new pending request', async () => {
    const previous = await admitPendingRequest(who, 'org-a', undefined, tables);
    await db`update ${db(tables.requests)} set status='denied' where id=${previous.request.id}`;
    expect((await readOwnPendingRequests(who.id, tables)).kind).toBe('none');
    const next = await admitPendingRequest(who, 'org-a', undefined, tables);
    expect(next.created).toBe(true);
    expect(next.request.id).not.toBe(previous.request.id);
  });
  it('orders equal timestamps by id so bounded pages are deterministic', async () => {
    const ids = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'];
    for (const [i, id] of ids.entries())
      await db`insert into ${db(tables.requests)}
      (id,supabase_id,user_id,email,organization_id,created_at)
      values (${id},${who.supabaseId},${who.id},${who.email},${'org-' + i},'2026-10-03T10:00:00Z')`;
    expect((await readOwnPendingRequests(who.id, tables)).requests.map((r) => r.id)).toEqual(
      [...ids].reverse(),
    );
  });
  it('fails unavailable on database errors and never returns provider or applicant details', async () => {
    await expect(
      admitPendingRequest(
        { ...who, supabaseId: 'PRIVATE_APPLICANT_INVALID_UUID' },
        'org-a',
        undefined,
        tables,
      ),
    ).rejects.toMatchObject({
      code: 'join_request_unavailable',
      message: 'Access requests are temporarily unavailable. Please try again.',
    });
    expect(await db`select id from ${db(tables.requests)}`).toHaveLength(0);
    await expect(
      readOwnPendingRequests(who.id, { ...tables, requests: `${schema}.missing` }),
    ).rejects.toMatchObject({ code: 'join_request_unavailable' });
  });
});
