import postgres from 'postgres';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

if (process.env.REQUIRE_CRM_CONTACTS_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_CONTACTS_POSTGRES is set but SUPABASE_DB_URL is empty — the dedicated ' +
      'CRM contacts PostgreSQL job must provide it.',
  );
}

const dialect = new PgDialect();
const client = databaseUrl
  ? postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 })
  : null;
const schema = `crm_page_${process.pid}_${Math.random().toString(36).slice(2)}`;

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const query = dialect.sqlToQuery(statement);
        return client!.unsafe(query.sql, query.params as never[]);
      },
    }),
}));
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => false,
}));

import { rankContactsPage } from './crm-contacts.service';

const ids = {
  ana1: '00000000-0000-4000-8000-000000000001',
  ana2: '00000000-0000-4000-8000-000000000002',
  bea: '00000000-0000-4000-8000-000000000003',
  phone: '00000000-0000-4000-8000-000000000004',
  dni: '00000000-0000-4000-8000-000000000005',
  unscored: '00000000-0000-4000-8000-000000000006',
};

describe.runIf(Boolean(databaseUrl))('rankContactsPage against PostgreSQL', () => {
  beforeAll(async () => {
    await client!.unsafe(`create schema ${schema}`);
    await client!.unsafe(`set search_path to ${schema}, public`);
    await client!.unsafe(`
      create table crm_contacts (
        id uuid primary key, display_name text, owner_id uuid, source text,
        lifecycle_override text, custom_fields jsonb not null default '{}',
        party_id uuid, deleted_at timestamptz
      );
      create table crm_contact_identities (
        contact_id uuid, org_id uuid, channel text, external_id text, handle text
      );
      create table messages (
        org_id uuid, channel text, chat_id text, occurred_at timestamptz,
        created_at timestamptz, direction text, is_bot boolean
      );
      create table parties (
        id uuid primary key, doc_number text, dni_verified boolean, dob date,
        metadata jsonb not null default '{}'
      );
      create table crm_contact_tags (contact_id uuid, tag_id uuid);
      create table meta_lead_attribution (
        org_id uuid, channel text, sender_id text, origin text,
        campaign_name text, first_contact_at timestamptz
      );
    `);
    await client!.unsafe(
      `insert into crm_contacts (id, display_name, custom_fields) values
       ($1, 'Ana', '{"_icp":{"score":90}}'),
       ($2, 'Ana', '{"_icp":{"score":90}}'),
       ($3, 'Bea', '{"_icp":{"score":70}}'),
       ($4, 'Phone', '{"telefono":"51987654321","_icp":{"score":60}}'),
       ($5, 'DNI', '{"dni":"44556677","_icp":{"score":50}}'),
       ($6, 'No score', '{}')`,
      [ids.ana1, ids.ana2, ids.bea, ids.phone, ids.dni, ids.unscored],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.unsafe(`drop schema if exists ${schema} cascade`);
    await client.end({ timeout: 5 });
  });

  it('keeps the independently counted total across populated and empty offsets', async () => {
    const [{ count }] = await client!.unsafe<{ count: number }[]>(
      'select count(*)::int as count from crm_contacts where deleted_at is null',
    );
    const first = await rankContactsPage({ db: {} as never, tenantId: ids.ana1 }, { limit: 2 });
    const empty = await rankContactsPage(
      { db: {} as never, tenantId: ids.ana1 },
      { limit: 2, offset: 100 },
    );
    expect(first.total).toBe(count);
    expect(first.rows).toHaveLength(2);
    expect(empty).toEqual({ rows: [], total: count });
  });

  it('sorts ICP null last and traverses tied rows exactly once', async () => {
    const seen: string[] = [];
    for (const offset of [0, 2, 4]) {
      const page = await rankContactsPage(
        { db: {} as never, tenantId: ids.ana1 },
        { sort: 'icp', limit: 2, offset },
      );
      seen.push(...page.rows.map((row) => row.contact_id));
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen.slice(0, 2)).toEqual([ids.ana1, ids.ana2]);
    expect(seen.at(-1)).toBe(ids.unscored);
  });

  it.each([
    ['5198', ids.phone],
    ['4455', ids.dni],
  ])('matches exact phone/DNI prefix %s', async (search, expectedId) => {
    const page = await rankContactsPage(
      { db: {} as never, tenantId: ids.ana1 },
      { search, limit: 20 },
    );
    expect(page.rows.map((row) => row.contact_id)).toEqual([expectedId]);
  });

  it.each(['8765', '5566'])('does not match phone/DNI mid-string %s', async (search) => {
    const page = await rankContactsPage(
      { db: {} as never, tenantId: ids.ana1 },
      { search, limit: 20 },
    );
    expect(page).toEqual({ rows: [], total: 0 });
  });
});
