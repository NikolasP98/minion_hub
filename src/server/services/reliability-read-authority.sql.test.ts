import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  RELIABILITY_MEMBER_AUTHORITY_QUERY,
  RELIABILITY_TARGET_QUERY,
} from './reliability-read-authority';

const ACTOR = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const GATEWAY = '00000000-0000-0000-0000-000000000003';

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.organizations (id uuid primary key,status text not null);
    create table public.profiles (id uuid primary key,role text);
    create table public.organization_members (
      organization_id uuid not null,profile_id uuid not null,role text
    );
    create table public.member_roles (
      org_id uuid not null,profile_id uuid not null,role_key text not null
    );
    create table public.gateway (
      id uuid primary key,org_id uuid not null,legacy_server_id text,url text not null
    );
  `);
});

afterEach(() => db.close());

describe('reliability authority SQL projection bounds', () => {
  it('returns only a field-overflow marker for oversized membership fields', async () => {
    const oversized = 'x'.repeat(20_000);
    await db.query('insert into public.organizations(id,status) values($1,$2)', [ORG, 'active']);
    await db.query('insert into public.profiles(id,role) values($1,$2)', [ACTOR, oversized]);
    await db.query(
      'insert into public.organization_members(organization_id,profile_id,role) values($1,$2,$3)',
      [ORG, ACTOR, oversized],
    );
    await db.query('insert into public.member_roles(org_id,profile_id,role_key) values($1,$2,$3)', [
      ORG,
      ACTOR,
      oversized,
    ]);

    const result = await db.query<{
      legacy_role: string | null;
      profile_role: string | null;
      role_key: string | null;
      field_overflow: boolean;
    }>(RELIABILITY_MEMBER_AUTHORITY_QUERY, [ORG, ACTOR]);
    expect(result.rows).toEqual([
      { legacy_role: null, profile_role: null, role_key: null, field_overflow: true },
    ]);
    expect(JSON.stringify(result.rows)).not.toContain('x'.repeat(257));
  });

  it('returns only a field-overflow marker for oversized gateway fields', async () => {
    const oversized = 'x'.repeat(20_000);
    await db.query(
      'insert into public.gateway(id,org_id,legacy_server_id,url) values($1,$2,$3,$4)',
      [GATEWAY, ORG, oversized, oversized],
    );

    const result = await db.query<{
      id: string;
      legacy_server_id: string | null;
      org_id: string;
      url: string | null;
      field_overflow: boolean;
    }>(RELIABILITY_TARGET_QUERY, [GATEWAY]);
    expect(result.rows).toEqual([
      {
        id: GATEWAY,
        legacy_server_id: null,
        org_id: ORG,
        url: null,
        field_overflow: true,
      },
    ]);
    expect(JSON.stringify(result.rows)).not.toContain('x'.repeat(257));
  });

  it('materializes at most the 65-row role sentinel', async () => {
    await db.query('insert into public.organizations(id,status) values($1,$2)', [ORG, 'active']);
    await db.query('insert into public.profiles(id,role) values($1,$2)', [ACTOR, 'user']);
    await db.query(
      'insert into public.organization_members(organization_id,profile_id,role) values($1,$2,$3)',
      [ORG, ACTOR, 'member'],
    );
    await db.query(
      `insert into public.member_roles(org_id,profile_id,role_key)
       select $1::uuid,$2::uuid,'role-' || n::text from generate_series(1,1000) source(n)`,
      [ORG, ACTOR],
    );

    const result = await db.query(RELIABILITY_MEMBER_AUTHORITY_QUERY, [ORG, ACTOR]);
    expect(result.rows).toHaveLength(65);
  });
});
