/**
 * RLS contract for `org_plans` / `org_plan_events`
 * (supabase/migrations/20261029100000_org_entitlements.sql). Skips unless
 * `HUB_TEST_DB_URL` is set (src/server/test-utils/test-db-url.ts). A mocked test
 * cannot prove SQL, so this runs the policy against a real local QA database.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { testDatabaseUrl } from '../test-utils/test-db-url';

const dbUrl = testDatabaseUrl();

// setOrgPlan runs its real SQL against the QA database; only the cache and analytics are stubbed.
const h = vi.hoisted(() => ({ db: null as unknown, invalidated: [] as string[][] }));
vi.mock('$server/db/pg-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoreDb: () => h.db,
}));
vi.mock('@minion-stack/cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateTags: async (t: string[]) => void h.invalidated.push(t),
}));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: () => {} }));

import { setOrgPlan } from './entitlements.service';

describe.skipIf(!dbUrl)('org_plans RLS (org_guc, select only)', () => {
  let sql: ReturnType<typeof postgres>;
  let orgA: string;
  let orgB: string;

  async function asMember<T>(org: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
    // Roll back by throwing so a write attempt never persists.
    let out!: T;
    await sql
      .begin(async (tx) => {
        await tx`select set_config('role', 'app_ledger', true), set_config('app.current_org_id', ${org}, true)`;
        out = await fn(tx);
        throw new Error('rollback');
      })
      .catch((e: Error) => {
        if (e.message !== 'rollback') throw e;
      });
    return out;
  }

  beforeAll(async () => {
    sql = postgres(dbUrl!, { prepare: false, max: 1 });
    [{ id: orgA }] =
      await sql`insert into organizations (name, slug) values ('qa-ent-a', 'qa-ent-a') returning id`;
    [{ id: orgB }] =
      await sql`insert into organizations (name, slug) values ('qa-ent-b', 'qa-ent-b') returning id`;
    await sql`insert into org_plans (org_id, plan_key) values (${orgA}, 'premium'), (${orgB}, 'base')`;
    await sql`insert into org_plan_events (org_id, to_plan, note) values (${orgA}, 'premium', 'qa-ent')`;
  });

  afterAll(async () => {
    await sql`delete from org_plan_events where org_id in (${orgA}, ${orgB})`;
    await sql`delete from organizations where id in (${orgA}, ${orgB})`; // cascades org_plans
    await sql.end();
  });

  it('a member reads its own plan row and no other org', async () => {
    const rows = await asMember(orgA, (tx) => tx`select org_id, plan_key from org_plans`);
    expect(rows.map((r) => r.org_id)).toEqual([orgA]);
    expect(rows[0].plan_key).toBe('premium');
  });

  it('denies INSERT, UPDATE and DELETE to the app role', async () => {
    for (const stmt of [
      (tx: postgres.TransactionSql) =>
        tx`insert into org_plans (org_id, plan_key) values (${orgA}, 'x')`,
      (tx: postgres.TransactionSql) =>
        tx`update org_plans set plan_key = 'premium' where org_id = ${orgA}`,
      (tx: postgres.TransactionSql) => tx`delete from org_plans where org_id = ${orgA}`,
    ]) {
      await expect(
        asMember(orgA, async (tx) => {
          await stmt(tx);
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('the audit table is unreadable by the app role', async () => {
    await expect(asMember(orgA, (tx) => tx`select * from org_plan_events`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe.skipIf(!dbUrl)('setOrgPlan against real SQL', () => {
  let sql: ReturnType<typeof postgres>;
  let org: string;
  const admin = { user: { id: 'u1', role: 'admin', supabaseId: null } } as unknown as App.Locals;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { prepare: false, max: 1 });
    h.db = drizzle(sql);
    [{ id: org }] =
      await sql`insert into organizations (name, slug) values ('qa-ent-set', 'qa-ent-set') returning id`;
  });

  afterAll(async () => {
    await sql`delete from org_plan_events where org_id = ${org}`;
    await sql`delete from organizations where id = ${org}`;
    await sql.end();
  });

  it('no-op on Base, then insert, then update, each change audited once', async () => {
    expect(await setOrgPlan(admin, org, 'base')).toEqual({ changed: false });
    expect(await sql`select 1 from org_plans where org_id = ${org}`).toHaveLength(0);

    expect(await setOrgPlan(admin, org, 'premium', ' launch ')).toEqual({ changed: true });
    expect(await setOrgPlan(admin, org, 'premium')).toEqual({ changed: false });
    expect(await setOrgPlan(admin, org, 'base')).toEqual({ changed: true });

    const [row] = await sql`select plan_key, set_note from org_plans where org_id = ${org}`;
    expect(row.plan_key).toBe('base');
    const events = await sql`select from_plan, to_plan, note, actor_profile_id from org_plan_events
      where org_id = ${org} order by created_at, id`;
    expect(events.map((e) => [e.from_plan, e.to_plan])).toEqual([
      [null, 'premium'],
      ['premium', 'base'],
    ]);
    expect(events[0].note).toBe('launch');
    expect(events.every((e) => e.actor_profile_id === null)).toBe(true);
    expect(h.invalidated).toHaveLength(2);
  });

  it('rejects prototype keys as plans', async () => {
    await expect(setOrgPlan(admin, org, 'constructor')).rejects.toMatchObject({ status: 400 });
  });
});

