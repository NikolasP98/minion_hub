import { describe, expect, it } from 'vitest';
import {
  FACES_ORG_ID,
  applyInTransaction,
  checkConnection,
  checkExpectBase,
  checkInvariants,
  planChanges,
  project,
  resolveBaseOrg,
  type OrgState,
  type Tx,
} from './backfill-launch-plans';

const BERNI = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const orgs = (): OrgState[] => [
  { id: FACES_ORG_ID, name: 'FACES', slug: 'faces', plan_key: null },
  { id: BERNI, name: 'Bernibites', slug: null, plan_key: null },
  { id: OTHER, name: 'Panik', slug: 'panik', plan_key: 'base' },
];

/** A fake postgres.js transaction over in-memory rows; `dropWriteFor` simulates a write that did not land. */
function fakeTx(state: OrgState[], dropWriteFor?: string) {
  const events: Array<{
    org: string;
    from: string | null;
    to: string;
    actor: unknown;
    note: string;
  }> = [];
  const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('lock table')) return [];
    if (text.includes('from public.organizations')) return state.map((o) => ({ ...o }));
    if (text.includes('insert into public.org_plans')) {
      const [org, to] = values as [string, string];
      const row = state.find((o) => o.id === org);
      if (row && org !== dropWriteFor) row.plan_key = to;
      return [];
    }
    if (text.includes('insert into public.org_plan_events')) {
      const [org, from, to, note] = values as [string, string | null, string, string];
      events.push({ org, from, to, actor: /, null, \?\)/.test(text) ? null : 'set', note });
      return [];
    }
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as Tx;
  return { tx, events };
}

describe('resolveBaseOrg', () => {
  it('finds Bernibites by name case-insensitively when the slug is null', () => {
    expect(resolveBaseOrg(orgs()).id).toBe(BERNI);
    expect(resolveBaseOrg([{ ...orgs()[1], name: 'BERNIBITES S.A.C.' }]).id).toBe(BERNI);
  });
  it('refuses zero or several matches', () => {
    expect(() => resolveBaseOrg([orgs()[0]])).toThrow(/exactly one.*found 0/);
    const twin = { id: OTHER, name: 'bernibites test', slug: null, plan_key: null };
    expect(() => resolveBaseOrg([...orgs(), twin])).toThrow(/found 2/);
  });
});

describe('checkExpectBase', () => {
  it('dry run needs no id; apply needs the matching one', () => {
    expect(checkExpectBase(false, undefined, BERNI)).toBeNull();
    expect(checkExpectBase(true, undefined, BERNI)).toMatch(/--expect-base/);
    expect(checkExpectBase(true, OTHER, BERNI)).toMatch(/does not match/);
    expect(checkExpectBase(true, BERNI.toUpperCase(), BERNI)).toBeNull();
  });
});

describe('checkConnection', () => {
  it('needs SUPABASE_DB_URL and refuses a test target or a test runner', () => {
    expect(checkConnection({})).toMatch(/SUPABASE_DB_URL/);
    expect(checkConnection({ SUPABASE_DB_URL: 'postgres://x', HUB_TEST_DB_URL: 'y' })).toMatch(
      /HUB_TEST_DB_URL/,
    );
    expect(checkConnection({ SUPABASE_DB_URL: 'postgres://x', VITEST: 'true' })).toMatch(/test/);
    expect(checkConnection({ SUPABASE_DB_URL: 'postgres://x' })).toBeNull();
  });
});

describe('planChanges + checkInvariants', () => {
  it('plans Premium for everyone but Bernibites, which gets an explicit Base row', () => {
    const changes = planChanges(orgs(), BERNI);
    expect(changes).toEqual([
      { orgId: FACES_ORG_ID, name: 'FACES', from: null, to: 'premium' },
      { orgId: BERNI, name: 'Bernibites', from: null, to: 'base' },
      { orgId: OTHER, name: 'Panik', from: 'base', to: 'premium' },
    ]);
    expect(checkInvariants(project(orgs(), changes), BERNI)).toEqual([]);
  });
  it('flags a second non-Premium org, a Premium Bernibites, and a missing or Base FACES', () => {
    expect(checkInvariants(orgs(), BERNI).join('\n')).toMatch(/exactly one org not Premium/);
    const allPremium = orgs().map((o) => ({ ...o, plan_key: 'premium' }));
    expect(checkInvariants(allPremium, BERNI).join('\n')).toMatch(/Bernibites/);
    const noFaces = project(orgs(), planChanges(orgs(), BERNI)).slice(1);
    expect(checkInvariants(noFaces, BERNI).join('\n')).toMatch(/FACES/);
  });
});

describe('applyInTransaction', () => {
  it('writes each change with a launch-backfill audit row and no actor; a second run plans 0 writes', async () => {
    const state = orgs();
    const first = fakeTx(state);
    expect(await applyInTransaction(first.tx, BERNI)).toHaveLength(3);
    expect(first.events).toEqual([
      { org: FACES_ORG_ID, from: null, to: 'premium', actor: null, note: 'launch-backfill' },
      { org: BERNI, from: null, to: 'base', actor: null, note: 'launch-backfill' },
      { org: OTHER, from: 'base', to: 'premium', actor: null, note: 'launch-backfill' },
    ]);
    const second = fakeTx(state);
    expect(await applyInTransaction(second.tx, BERNI)).toEqual([]);
    expect(second.events).toEqual([]);
  });

  it('throws out of the transaction (postgres.js rolls back) when a post-write assertion fails', async () => {
    const { tx } = fakeTx(orgs(), OTHER);
    await expect(applyInTransaction(tx, BERNI)).rejects.toThrow(/rolled back/);
  });

  it('refuses when --expect-base does not match the Bernibites it resolves inside the transaction', async () => {
    const { tx, events } = fakeTx(orgs());
    await expect(applyInTransaction(tx, OTHER)).rejects.toThrow(/does not match/);
    expect(events).toEqual([]);
  });
});
