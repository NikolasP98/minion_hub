import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

/**
 * `crm_settings.value.icp` atomic-write coverage (spec 2026-08-03-crm-icp-score-
 * spec §3.1, §6.1). `saveIcpDefinition` computes the next `icp.version` in the
 * SAME statement that writes it, from the row it updates — no read-modify-write.
 * These tests pin the shipped statement shape and the behaviour on a real
 * Postgres engine (pglite).
 *
 * NOTE the file name: deliberately NOT `*.sql.integration.test.ts`, which is the
 * native-Postgres suffix frozen by `scripts/qc/native-postgres-manifest.ts`.
 */

// The service only needs `withOrgCore` to hand it the real transaction.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (
    scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
    fn: (tx: unknown) => unknown,
  ) => scope.db.transaction((tx: unknown) => fn(tx)),
}));

import { saveIcpDefinition } from './crm-settings.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const INPUT = {
  description: 'Clinics with 3+ chairs',
  criteria: [{ id: 'size', label: 'Has 3+ chairs', weight: 3 }],
  disqualifiers: ['Student'],
};

const MAX_SAFE = 9007199254740991;

async function createDb() {
  const client = new PGlite();
  const queries: string[] = [];
  const db = drizzle(client, { logger: { logQuery: (q: string) => queries.push(q) } });
  // Only the columns the shipped SQL touches. RLS is absent in pglite, so the
  // org scoping under test is the explicit `org_id =` predicate.
  await client.exec(`
    create table crm_settings (
      org_id text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table crm_contacts (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      custom_fields jsonb not null default '{}'::jsonb
    );
  `);
  const ctx = (org = ORG) => ({ db: db as never, tenantId: org });
  const setValue = (value: unknown, org = ORG) =>
    client.query(`insert into crm_settings (org_id, value) values ($1, $2::jsonb)`, [
      org,
      JSON.stringify(value),
    ]);
  const getValue = async (org = ORG) => {
    const res = await client.query<{ value: Record<string, unknown> }>(
      `select value from crm_settings where org_id = $1`,
      [org],
    );
    return res.rows[0]?.value;
  };
  const addContact = (customFields: unknown, org = ORG) =>
    client.query(`insert into crm_contacts (org_id, custom_fields) values ($1, $2::jsonb)`, [
      org,
      JSON.stringify(customFields),
    ]);
  return { client, ctx, queries, setValue, getValue, addContact };
}

describe('saveIcpDefinition against a real Postgres engine (pglite)', () => {
  // One engine for the file (pglite start-up is the slow part); each test
  // starts from empty tables.
  let t: Awaited<ReturnType<typeof createDb>>;
  beforeAll(async () => {
    t = await createDb();
  });
  afterAll(async () => {
    await t.client.close();
  });
  beforeEach(async () => {
    await t.client.exec('truncate crm_settings, crm_contacts');
  });

  it('first save on an org that has other settings: version 1, siblings byte-identical', async () => {
    const siblings = {
      accounts: [{ channel: 'whatsapp', accountId: 'a1', label: null, paused: false }],
      deposit: { keywords: ['adelanto'], label: 'Adelanto' },
      winAnalysis: { builtAt: '2026-08-01T00:00:00Z', basedOn: 4, nested: { a: [1, 2] } },
    };
    await t.setValue(siblings);

    const saved = await saveIcpDefinition(t.ctx(), INPUT);

    expect(saved).toMatchObject({ ...INPUT, version: 1 });
    const after = await t.getValue();
    expect(after).toMatchObject(siblings);
    expect(Object.keys(after!).sort()).toEqual(['accounts', 'deposit', 'icp', 'winAnalysis']);
    expect(after!.icp).toEqual(saved);
  });

  it('first save with no row creates it at version 1', async () => {
    const saved = await saveIcpDefinition(t.ctx(), INPUT);
    expect(saved.version).toBe(1);
    expect(await t.getValue()).toEqual({ icp: saved });
  });

  it('two sequential saves give versions 1 then 2, with a server-stamped ISO updatedAt', async () => {
    const before = Date.now();
    const first = await saveIcpDefinition(t.ctx(), INPUT);
    // A no-op edit still bumps (spec §3.1, "bump on ANY edit").
    const second = await saveIcpDefinition(t.ctx(), INPUT);
    expect([first.version, second.version]).toEqual([1, 2]);
    for (const d of [first, second]) {
      expect(new Date(d.updatedAt).toISOString()).toBe(d.updatedAt);
      expect(new Date(d.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it.each([
    ['a string "7"', '7'],
    ['a non-integral 1.5', 1.5],
    ['an out-of-range 1e100', 1e100],
    ['zero', 0],
    ['a negative', -4],
    ['null', null],
    ['an object', { n: 5 }],
  ])('a stored icp.version that is %s is ignored: the next save succeeds at 1', async (_l, bad) => {
    await t.setValue({
      icp: { ...INPUT, version: bad, updatedAt: 'x' },
      deposit: { keywords: [] },
    });
    const saved = await saveIcpDefinition(t.ctx(), INPUT);
    expect(saved.version).toBe(1);
    expect((await t.getValue())!.deposit).toEqual({ keywords: [] });
  });

  it.each([
    ['a numeric string', '7'],
    ['non-numeric text', 'not-a-number'],
    ['a fraction', 1.5],
    ['a number beyond bigint (1e100)', 1e100],
    ['zero', 0],
    ['a negative', -4],
  ])(
    'a stored version of %s counts as 0: the save succeeds at version 1',
    async (_label, stored) => {
      await t.setValue({ icp: { version: stored } });
      expect((await saveIcpDefinition(t.ctx(), INPUT)).version).toBe(1);
    },
  );

  it('numbering moves beyond the highest cached _icp.icpVersion in the SAME org only', async () => {
    await t.setValue({ icp: { ...INPUT, version: 2, updatedAt: '2026-08-01T00:00:00.000Z' } });
    await t.addContact({ _icp: { icpVersion: 9 } });
    await t.addContact({ _icp: { icpVersion: 4 } });
    await t.addContact({ _icp: { icpVersion: 99 } }, OTHER_ORG);
    // Corrupt cached versions are ignored, not fatal.
    await t.addContact({ _icp: { icpVersion: 1e100 } });
    await t.addContact({ _icp: { icpVersion: 'x' } });
    await t.addContact({ nombre: 'sin icp' });

    expect((await saveIcpDefinition(t.ctx(), INPUT)).version).toBe(10);
    // And the other org is unaffected by the first one's contacts.
    expect((await saveIcpDefinition(t.ctx(OTHER_ORG), INPUT)).version).toBe(100);
  });

  it('the cached max also applies when the org has no settings row yet', async () => {
    await t.addContact({ _icp: { icpVersion: 6 } });
    expect((await saveIcpDefinition(t.ctx(), INPUT)).version).toBe(7);
  });

  it('a stored version of 2^53-1 makes the save throw and leaves the row unchanged', async () => {
    const stored = {
      icp: { ...INPUT, version: MAX_SAFE, updatedAt: '2026-08-01T00:00:00.000Z' },
    };
    await t.setValue(stored);
    await expect(saveIcpDefinition(t.ctx(), INPUT)).rejects.toThrow();
    expect(await t.getValue()).toEqual(stored);
  });

  it('issues exactly one statement against crm_settings: jsonb_set on {icp}, no read before it', async () => {
    await t.setValue({ deposit: { keywords: [] } });
    t.queries.length = 0;
    await saveIcpDefinition(t.ctx(), INPUT);

    const touching = t.queries.filter((q) => /crm_settings/i.test(q));
    expect(touching).toHaveLength(1);
    expect(touching[0]).toContain('jsonb_set');
    expect(touching[0]).toContain("'{icp}'");
    expect(touching[0].trimStart().toLowerCase().startsWith('insert into')).toBe(true);
    expect(
      t.queries.some(
        (q) => /select[^]*from\s+"?crm_settings"?/i.test(q) && !/^insert/i.test(q.trimStart()),
      ),
    ).toBe(false);
  });

  it('5 concurrent saves yield exactly the versions {1..5}, no duplicates', async () => {
    // pglite serializes statements on one connection, so this proves the
    // version is computed per statement from the row — NOT true
    // multi-connection concurrency.
    // TODO(handoff): no native-Postgres concurrency test for saveIcpDefinition — model it on crm-funnel.concurrent.integration.test.ts and register it in scripts/qc/native-postgres-manifest.ts (that manifest's frozen count is why none is added in this node).
    const saved = await Promise.all(
      Array.from({ length: 5 }, () => saveIcpDefinition(t.ctx(), INPUT)),
    );
    expect(saved.map((d) => d.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(((await t.getValue())!.icp as { version: number }).version).toBe(5);
  });
});
