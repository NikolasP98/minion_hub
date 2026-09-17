import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { phone9 } from './party.service';

describe('phone9', () => {
  it('keeps the last 9 digits, stripping non-digits and country code', () => {
    expect(phone9('+51 992 376 833')).toBe('992376833');
    expect(phone9('51992376833')).toBe('992376833');
    expect(phone9('992376833')).toBe('992376833');
  });

  it('returns null for too-short or empty input', () => {
    expect(phone9('1234567')).toBeNull(); // 7 digits
    expect(phone9('')).toBeNull();
    expect(phone9(null)).toBeNull();
    expect(phone9(undefined)).toBeNull();
  });

  it('matches the two facets that should dedup to one party', () => {
    // CRM identity (WhatsApp jid) and finance client phone → same key.
    expect(phone9('51992376833@s.whatsapp.net')).toBe(phone9('992376833'));
  });
});

// withOrgCore's real implementation issues role/GUC `tx.execute(...)` calls
// pglite doesn't support; mirror crm-contacts.service.test.ts's approach of
// mocking it down to the plain `db.transaction(cb => cb(db))` shape.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (scope: { db: unknown }, fn: (tx: unknown) => unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(scope.db),
}));

describe('searchParties ordering + verified filter (customer picker "verified first")', () => {
  // Real Postgres engine (WASM, via pglite) — the tiered ORDER BY and the
  // `verified:'only'` fallback are exactly the kind of logic a chain-proxy
  // mock can't prove (see crm-contacts.service.test.ts's createRealCrmContactsDb).
  async function seededDb(orgId: string) {
    const client = new PGlite();
    const db = drizzle(client);
    await client.exec(`
      create table parties (
        id uuid primary key,
        org_id text not null,
        type text not null default 'person',
        name text,
        email text,
        doc_number text,
        phone9 text,
        dni_verified boolean not null default false
      );
    `);
    await db.execute(sql`
      insert into parties (id, org_id, type, name, doc_number, dni_verified) values
        ('11111111-1111-1111-1111-111111111111', ${orgId}, 'person', 'Zoe Verified', '00000001', true),
        ('22222222-2222-2222-2222-222222222222', ${orgId}, 'person', 'Ana Documented', '00000002', false),
        ('33333333-3333-3333-3333-333333333333', ${orgId}, 'person', 'Bo Bare', null, false),
        ('55555555-5555-5555-5555-555555555555', ${orgId}, 'company', 'Acme Supplies SAC', '20512345678', false)
    `);
    return { client, ctx: { db, tenantId: orgId } as unknown as CoreCtx };
  }

  // Each test below passes an explicit 20s timeout: PGlite (WASM Postgres)
  // startup is CPU-bound and can exceed the 5s testTimeout default under
  // parallel worker load — same reasoning as vitest.config.ts's
  // hookTimeout: 30_000 (which doesn't cover this file's inline-in-`it` setup).
  it("verified:'only' returns just the verified tier when the org has one", async () => {
    const { client, ctx } = await seededDb('org-1');
    const { searchParties } = await import('./party.service');
    const rows = await searchParties(ctx, '', { types: ['person'], verified: 'only' });
    expect(rows.map((r) => r.name)).toEqual(['Zoe Verified']);
    await client.close();
  }, 20_000);

  it("verified:'only' falls back to the plain list for a fresh org with zero verified clients", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await client.exec(`
      create table parties (
        id uuid primary key, org_id text not null, type text not null default 'person',
        name text, email text, doc_number text, phone9 text,
        dni_verified boolean not null default false
      );
    `);
    await db.execute(sql`
      insert into parties (id, org_id, type, name, dni_verified) values
        ('44444444-4444-4444-4444-444444444444', 'org-2', 'person', 'Cam Fresh', false)
    `);
    const { searchParties } = await import('./party.service');
    const rows = await searchParties({ db, tenantId: 'org-2' } as unknown as CoreCtx, '', {
      types: ['person'],
      verified: 'only',
    });
    expect(rows.map((r) => r.name)).toEqual(['Cam Fresh']);
    await client.close();
  }, 20_000);

  it("verified:'first' ranks verified, then documented, then the rest — name asc within a tier", async () => {
    const { client, ctx } = await seededDb('org-1');
    const { searchParties } = await import('./party.service');
    const rows = await searchParties(ctx, '', { types: ['person'], verified: 'first' });
    expect(rows.map((r) => r.name)).toEqual(['Zoe Verified', 'Ana Documented', 'Bo Bare']);
    await client.close();
  }, 20_000);

  it('omitting `verified` searches everyone unranked (existing callers unaffected)', async () => {
    const { client, ctx } = await seededDb('org-1');
    const { searchParties } = await import('./party.service');
    const rows = await searchParties(ctx, '', { types: ['person'] });
    // No verified/verifiedOnly opt-in → plain name-asc, same as before this change.
    expect(rows.map((r) => r.name)).toEqual(['Ana Documented', 'Bo Bare', 'Zoe Verified']);
    await client.close();
  }, 20_000);

  it('legacy verifiedOnly:true (verified=1) still hard-filters with no fallback', async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await client.exec(`
      create table parties (
        id uuid primary key, org_id text not null, type text not null default 'person',
        name text, email text, doc_number text, phone9 text,
        dni_verified boolean not null default false
      );
    `);
    await db.execute(sql`
      insert into parties (id, org_id, type, name, dni_verified) values
        ('55555555-5555-5555-5555-555555555555', 'org-3', 'person', 'Dee Unverified', false)
    `);
    const { searchParties } = await import('./party.service');
    const rows = await searchParties({ db, tenantId: 'org-3' } as unknown as CoreCtx, '', {
      types: ['person'],
      verifiedOnly: true,
    });
    expect(rows).toEqual([]);
    await client.close();
  }, 20_000);
});

describe('searchParties RUC support (DNI = 8 digits, RUC = 11 digits)', () => {
  async function seededDb(orgId: string) {
    const client = new PGlite();
    const db = drizzle(client);
    await client.exec(`
      create table parties (
        id uuid primary key, org_id text not null, type text not null default 'person',
        name text, email text, doc_number text, phone9 text,
        dni_verified boolean not null default false
      );
    `);
    await db.execute(sql`
      insert into parties (id, org_id, type, name, doc_number, dni_verified) values
        ('11111111-1111-1111-1111-111111111111', ${orgId}, 'person', 'Zoe Verified', '60525600', true),
        ('22222222-2222-2222-2222-222222222222', ${orgId}, 'company', 'Acme Supplies SAC', '20512345678', false),
        ('33333333-3333-3333-3333-333333333333', ${orgId}, 'person', 'Bo Bare', null, false)
    `);
    return { client, ctx: { db, tenantId: orgId } as unknown as CoreCtx };
  }

  it("doc:'ruc' returns only 11-digit document holders (stock entries counterpart picker)", async () => {
    const { client, ctx } = await seededDb('org-r');
    const { searchParties } = await import('./party.service');
    const rows = await searchParties(ctx, '', { doc: 'ruc' });
    expect(rows.map((r) => r.name)).toEqual(['Acme Supplies SAC']);
    await client.close();
  }, 20_000);

  it("doc:'dni' returns only 8-digit document holders", async () => {
    const { client, ctx } = await seededDb('org-r');
    const { searchParties } = await import('./party.service');
    const rows = await searchParties(ctx, '', { doc: 'dni' });
    expect(rows.map((r) => r.name)).toEqual(['Zoe Verified']);
    await client.close();
  }, 20_000);

  it('a typed RUC number finds the company, exactly like a typed DNI finds the person', async () => {
    const { client, ctx } = await seededDb('org-r');
    const { searchParties } = await import('./party.service');
    expect((await searchParties(ctx, '20512345678')).map((r) => r.name)).toEqual([
      'Acme Supplies SAC',
    ]);
    expect((await searchParties(ctx, '60525600')).map((r) => r.name)).toEqual(['Zoe Verified']);
    expect((await searchParties(ctx, '99999999999', { doc: 'ruc' })).map((r) => r.name)).toEqual(
      [],
    );
    await client.close();
  }, 20_000);
});
