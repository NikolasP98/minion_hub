import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { CoreCtx } from '$server/auth/core-ctx';
import { maskPii } from '$lib/pii';
import { getContactPrefill } from './crm-contacts.service';
import { getParty, getPartyForRead, searchParties } from './party.service';
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (
    scope: { db: ReturnType<typeof drizzle> },
    fn: (tx: ReturnType<typeof drizzle>) => unknown,
  ) => fn(scope.db),
}));
const org = 'read-org',
  owner = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002';
const own = '20000000-0000-4000-8000-000000000001',
  foreign = '20000000-0000-4000-8000-000000000002',
  deleted = '20000000-0000-4000-8000-000000000003';
const ownParty = '30000000-0000-4000-8000-000000000001',
  foreignParty = '30000000-0000-4000-8000-000000000002',
  supplier = '30000000-0000-4000-8000-000000000003';
let client: PGlite, ctx: CoreCtx;
beforeAll(async () => {
  client = new PGlite();
  ctx = { db: drizzle(client), tenantId: org, profileId: owner } as unknown as CoreCtx;
  await client.exec(`create table crm_contacts(id uuid primary key,org_id text,display_name text,custom_fields jsonb,owner_id uuid,party_id uuid,deleted_at timestamptz);
 create table crm_contact_identities(org_id text,contact_id uuid,channel text,external_id text);
 create table parties(id uuid primary key,org_id text,type text,name text,agent_id text,phone9 text,email text,doc_type text,doc_number text,dob date,dni_verified boolean,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());`);
}, 30000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await client.exec(
    'delete from crm_contact_identities;delete from crm_contacts;delete from parties;',
  );
  for (const [id, name, phone, email, doc] of [
    [ownParty, 'Own Customer', '900111222', 'own@example.invalid', '12345678'],
    [foreignParty, 'Foreign Customer', '900333444', 'foreign@example.invalid', '87654321'],
    [supplier, 'Unlinked Supplier', '900555666', 'supplier@example.invalid', '20512345678'],
  ])
    await client.query(
      `insert into parties(id,org_id,type,name,phone9,email,doc_number,dni_verified,metadata) values($1,$2,'person',$3,$4,$5,$6,true,'{"registry":{"secret":"raw"}}')`,
      [id, org, name, phone, email, doc],
    );
  await client.query(
    `insert into crm_contacts(id,org_id,display_name,custom_fields,owner_id,party_id,deleted_at) values($1,$4,'Own Customer','{"email":"own@example.invalid"}',$5,$7,null),($2,$4,'Foreign Customer','{"correo":"foreign@example.invalid"}',$6,$8,null),($3,$4,'Deleted','{}',$5,null,now())`,
    [own, foreign, deleted, org, owner, other, ownParty, foreignParty],
  );
  await client.query(
    `insert into crm_contact_identities values($1,$2,'whatsapp','51900111222@s.whatsapp.net'),($1,$3,'whatsapp','51900333444@s.whatsapp.net')`,
    [org, own, foreign],
  );
});
describe('canonical own-record and sensitive-field read projections', () => {
  it('prefill returns only live owned contacts and masks phone/email using existing conventions', async () => {
    expect(await getContactPrefill(ctx, foreign, owner, true)).toBeNull();
    expect(await getContactPrefill(ctx, deleted, owner, true)).toBeNull();
    expect(await getContactPrefill(ctx, own, owner, true)).toEqual({
      name: 'Own Customer',
      phone: maskPii('51900111222'),
      email: maskPii('own@example.invalid'),
    });
    expect(await getContactPrefill(ctx, own, owner, false)).toEqual({
      name: 'Own Customer',
      phone: '51900111222',
      email: 'own@example.invalid',
    });
  });
  it('CRM-only party scope requires an owned live facet and never leaks registry metadata', async () => {
    const scope = { ownerId: owner, maskSensitive: true };
    expect(await getPartyForRead(ctx, foreignParty, scope)).toBeNull();
    expect(await getPartyForRead(ctx, supplier, scope)).toBeNull();
    const row = await getPartyForRead(ctx, ownParty, scope);
    expect(row).toMatchObject({
      id: ownParty,
      phone9: maskPii('900111222'),
      email: maskPii('own@example.invalid'),
      docNumber: maskPii('12345678'),
    });
    expect(row).not.toHaveProperty('metadata');
    expect(row).not.toHaveProperty('orgId');
    expect((await searchParties(ctx, '', { ...scope, verified: 'only' })).map((r) => r.id)).toEqual(
      [ownParty],
    );
  });
  it('mixed legitimate customer/supplier reads permit unlinked parties and retain the CRM ownership floor', async () => {
    const scope = { ownerId: owner, allowUnlinked: true, maskSensitive: true };
    expect((await searchParties(ctx, '', scope)).map((r) => r.id)).toEqual([ownParty, supplier]);
    expect((await getPartyForRead(ctx, supplier, scope))?.phone9).toBe(maskPii('900555666'));
    expect(await getPartyForRead(ctx, foreignParty, scope)).toBeNull();
  });
  it('masked searches never probe hidden phone, email, document values or document shape', async () => {
    const scope = { ownerId: owner, maskSensitive: true };
    for (const q of ['900111222', 'own@example.invalid', '12345678', 'Customer 900111222'])
      expect(await searchParties(ctx, q, scope)).toEqual([]);
    expect(
      (await searchParties(ctx, 'Own Customer', { ...scope, doc: 'ruc' })).map((r) => r.id),
    ).toEqual([ownParty]);
    expect((await searchParties(ctx, 'Own Customer', scope))[0].phone9).toBe(maskPii('900111222'));
  });
  it('verified-only fallback still applies ownership, including deleted CRM facets', async () => {
    await client.query('update parties set dni_verified=false where id=$1', [ownParty]);
    expect(
      (await searchParties(ctx, '', { ownerId: owner, verified: 'only' })).map((r) => r.id),
    ).toEqual([ownParty]);
    await client.query('update crm_contacts set deleted_at=now() where id=$1', [own]);
    expect(await searchParties(ctx, '', { ownerId: owner, verified: 'only' })).toEqual([]);
  });
  it('unrestricted shared-party internals and non-CRM projections retain registration/supplier behavior', async () => {
    expect((await getParty(ctx, foreignParty))?.email).toBe('foreign@example.invalid');
    expect((await getPartyForRead(ctx, foreignParty))?.docNumber).toBe('87654321');
    expect((await searchParties(ctx, '20512345678', { doc: 'ruc' })).map((r) => r.id)).toEqual([
      supplier,
    ]);
  });
  it('all projections remain organization bounded', async () => {
    const foreignCtx = { ...ctx, tenantId: 'other-org' };
    expect(await getContactPrefill(foreignCtx, own, owner, false)).toBeNull();
    expect(await getPartyForRead(foreignCtx, ownParty, { ownerId: owner })).toBeNull();
    expect(await searchParties(foreignCtx, '', { ownerId: owner, allowUnlinked: true })).toEqual(
      [],
    );
  });
});
