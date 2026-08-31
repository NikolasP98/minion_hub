import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { icpDefinitionSchema } from '$lib/components/crm/crm-icp';

/**
 * `crm_settings.value.icp` atomic-write coverage (spec
 * 2026-08-03-crm-icp-score-spec, S1) — run against a REAL Postgres engine
 * (PGlite), the same way `crm-journey.atomic-write.test.ts` pins the `_journey`
 * writer. Statement-shape assertions live next door in
 * `crm-settings.service.test.ts`; what needs an engine is the behaviour those
 * shapes buy:
 *
 * - `icp.version` is derived by Postgres from the row being updated, so a bump
 *   can never be computed from a value this process read earlier (that is a
 *   lost update, and a lost version bump means every affected contact keeps a
 *   stale `_icp` forever — the dirty gate is signature-based, never age-based).
 * - Only the `icp` key is written: `deposit` / `accounts` / `winAnalysis` on the
 *   same single-row-per-org jsonb blob survive untouched.
 * - A corrupt stored version does not turn the next save into a cast error.
 */

const pg = new PGlite();
const db = drizzle(pg);

// The service opens `withOrgCore` (RLS role + GUC setup) — PGlite has no
// `app_ledger` role, and RLS is not what this suite is about, so the wrapper is
// replaced by a plain transaction on the same engine. Everything under test
// (the upsert, the version expression, the round-trip parse) runs for real.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: { db: typeof db }, fn: (tx: unknown) => unknown) =>
    scope.db.transaction((tx) => fn(tx) as Promise<unknown>),
}));

const { saveIcpDefinition, readCrmSettingsValue, resolveIcpDefinition } =
  await import('./crm-settings.service');

const ctx = { db: db as never, tenantId: 'org-1' };

const DEFINITION = {
  description: 'Clinics in Lima with budget for a full treatment plan.',
  criteria: [{ id: 'budget', label: 'Has budget for a full plan', weight: 5 }],
  disqualifiers: ['only ever asks for free consults'],
};

beforeEach(async () => {
  await pg.exec(`
    drop table if exists crm_settings;
    create table crm_settings (
      org_id text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    drop table if exists crm_contacts;
    create table crm_contacts (
      id uuid primary key,
      org_id text not null,
      custom_fields jsonb not null default '{}'::jsonb
    );
  `);
});

/** Reads the raw stored blob. PGlite's `execute` resolves to `{ rows, fields }`
 *  where the production postgres-js driver resolves to the row array — this
 *  suite only inspects rows, so it normalizes here rather than proxying the tx. */
async function storedIcp(orgId = 'org-1') {
  const res = (await db.execute(sql`select value from crm_settings where org_id = ${orgId}`)) as
    | { rows?: Array<{ value: { icp?: { version?: number } } }> }
    | Array<{ value: { icp?: { version?: number } } }>;
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return rows[0]?.value?.icp;
}

describe('saveIcpDefinition against a real Postgres engine', () => {
  it('inserts the first definition at version 1 and stamps updatedAt server-side', async () => {
    const saved = await saveIcpDefinition(ctx, DEFINITION);
    expect(saved.version).toBe(1);
    expect(saved.description).toBe(DEFINITION.description);
    expect(saved.criteria).toEqual(DEFINITION.criteria);
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
    expect((await storedIcp())?.version).toBe(1);
  });

  it('bumps the version on EVERY save, including an edit that changes nothing', async () => {
    // Cheap over-invalidation is the deliberate ruling (spec §3.1 "bump on ANY
    // edit"): a "did anything really change" comparison would have to know
    // which fields the judge is sensitive to, and getting that wrong leaves a
    // silently stale score.
    expect((await saveIcpDefinition(ctx, DEFINITION)).version).toBe(1);
    expect((await saveIcpDefinition(ctx, DEFINITION)).version).toBe(2);
    expect((await saveIcpDefinition(ctx, { ...DEFINITION, disqualifiers: [] })).version).toBe(3);
  });

  it('derives the next version from the row AT WRITE TIME, not from anything read earlier', async () => {
    await saveIcpDefinition(ctx, DEFINITION);
    // A second operator's save lands in between. A read-modify-write writer
    // that had captured version 1 would answer 2 here and silently erase this
    // bump; the shipped one reads the column inside its own UPDATE and answers 8.
    await db.execute(
      sql`update crm_settings set value = jsonb_set(value, '{icp,version}', '7'::jsonb) where org_id = 'org-1'`,
    );
    expect((await saveIcpDefinition(ctx, DEFINITION)).version).toBe(8);
  });

  it('writes ONLY the `icp` key — the other features sharing this row are untouched', async () => {
    await db.execute(sql`
      insert into crm_settings (org_id, value)
      values ('org-1', '{"deposit":{"keywords":["reserva"]},"accounts":["a1"]}'::jsonb)
    `);
    await saveIcpDefinition(ctx, DEFINITION);
    const value = await readCrmSettingsValue(ctx);
    expect(value.deposit).toEqual({ keywords: ['reserva'] });
    expect(value.accounts).toEqual(['a1']);
    expect((value.icp as { version: number }).version).toBe(1);
  });

  it('advances beyond cached versions when the stored version is not a number', async () => {
    // `(value->'icp'->>'version')::int` on a corrupt blob is a 22P02 that would
    // make the settings page permanently unsaveable; the jsonb_typeof guard
    // treats it as "no usable previous version".
    await db.execute(sql`
      insert into crm_settings (org_id, value) values ('org-1', '{"icp":{"version":"two"}}'::jsonb)
    `);
    await db.execute(sql`
      insert into crm_contacts (id, org_id, custom_fields)
      values ('00000000-0000-0000-0000-000000000001', 'org-1', '{"_icp":{"icpVersion":1}}'::jsonb)
    `);
    expect((await saveIcpDefinition(ctx, DEFINITION)).version).toBe(2);
  });

  it.each([
    ['negative', '-5'],
    ['too large for a JavaScript-safe version', '1e100'],
  ])('repairs a %s numeric stored version and round-trips safely', async (_label, version) => {
    await db.execute(sql`
      insert into crm_settings (org_id, value)
      values ('org-1', jsonb_build_object('icp', jsonb_build_object('version', ${version}::numeric)))
    `);

    const saved = await saveIcpDefinition(ctx, DEFINITION);
    expect(saved.version).toBe(1);
    const stored = await storedIcp();
    expect(stored?.version).toBe(1);
    expect(icpDefinitionSchema.safeParse(stored).success).toBe(true);
    expect(await resolveIcpDefinition(ctx)).toEqual(saved);
  });

  it('rejects version exhaustion without reusing the last safe version', async () => {
    await db.execute(sql`
      insert into crm_settings (org_id, value)
      values ('org-1', '{"icp":{"version":"broken"}}'::jsonb)
    `);
    await db.execute(sql`
      insert into crm_contacts (id, org_id, custom_fields)
      values (
        '00000000-0000-0000-0000-000000000001',
        'org-1',
        '{"_icp":{"icpVersion":9007199254740990}}'::jsonb
      )
    `);

    const lastSafe = await saveIcpDefinition(ctx, DEFINITION);
    expect(lastSafe.version).toBe(Number.MAX_SAFE_INTEGER);

    await expect(saveIcpDefinition(ctx, DEFINITION)).rejects.toThrow('repair required');
    expect((await storedIcp())?.version).toBe(Number.MAX_SAFE_INTEGER);
    expect(await resolveIcpDefinition(ctx)).toEqual(lastSafe);
  });

  it("is org-scoped: saving for one org leaves another org's definition alone", async () => {
    await saveIcpDefinition({ db: db as never, tenantId: 'org-2' }, DEFINITION);
    await saveIcpDefinition(ctx, DEFINITION);
    await saveIcpDefinition(ctx, DEFINITION);
    expect((await storedIcp('org-1'))?.version).toBe(2);
    expect((await storedIcp('org-2'))?.version).toBe(1);
  });

  it('round-trips through the reader that the tick and the roster will use', async () => {
    expect(await resolveIcpDefinition(ctx)).toBeNull(); // no row ⇒ feature OFF
    await saveIcpDefinition(ctx, DEFINITION);
    const read = await resolveIcpDefinition(ctx);
    expect(read?.version).toBe(1);
    expect(read?.criteria[0]?.id).toBe('budget');
  });

  it('rejects an invalid definition BEFORE touching the row', async () => {
    await saveIcpDefinition(ctx, DEFINITION);
    await expect(
      saveIcpDefinition(ctx, { ...DEFINITION, criteria: [{ id: 'x', label: 'x', weight: 9 }] }),
    ).rejects.toThrow();
    // Version unchanged — a rejected write must not invalidate every cached score.
    expect((await storedIcp())?.version).toBe(1);
  });
});
