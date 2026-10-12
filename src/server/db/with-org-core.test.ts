import { describe, it, expect, beforeEach } from 'vitest';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from './with-org-core';
import { createAmbientOrgTx } from './ambient-org-tx';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  createPerformanceContext,
  currentPerformanceSnapshot,
  runWithPerformanceContext,
} from '$lib/server/performance-context';

// withOrgCore transacts on the scope's own db handle, so we pass a fake scope
// whose db.transaction passes a tx through and records the executed setup SQL.
const executed: string[] = [];

function fakeScope(tenantId: string) {
  const tx = {
    execute: async (q: unknown) => {
      // drizzle sql`` tags aren't stringifiable via String(); serialize the
      // whole object so assertions can see the query chunks.
      executed.push(JSON.stringify(q));
    },
  };
  return {
    db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
    tenantId,
  } as unknown as Parameters<typeof withOrgCore>[0];
}

beforeEach(() => {
  executed.length = 0;
});

describe('withOrgCoreTransaction', () => {
  it('keeps the admitted tenant/profile when a caller mutates its scope during capture', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: async (query: SQL) => {
        queries.push(new PgDialect().sqlToQuery(query));
        return [{ role: 'none', org: null, profile: null, timeout: '0' }];
      },
    } as unknown as CoreTx;
    const scope = { tenantId: 'original', profileId: 'actor' };
    const running = withOrgCoreTransaction(scope, tx, async () => 1);
    scope.tenantId = 'changed';
    scope.profileId = 'other';
    await running;
    expect(queries[1]?.params).toEqual(['original', 'actor']);
  });

  it('captures and restores role, tenant, profile and timeout on the same transaction', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: async (query: SQL) => {
        queries.push(new PgDialect().sqlToQuery(query));
        return [
          { role: 'none', org: 'previous-org', profile: 'previous-profile', timeout: '3min' },
        ];
      },
    } as unknown as CoreTx;
    await expect(
      withOrgCoreTransaction({ tenantId: 'next-org' }, tx, async (received) => {
        expect(received).toBe(tx);
        expect(queries).toHaveLength(2);
        return 7;
      }),
    ).resolves.toBe(7);
    expect(queries).toHaveLength(3);
    expect(queries[1]?.params).toEqual(['next-org', '']);
    expect(queries[2]?.params).toEqual(['none', 'previous-org', 'previous-profile', '3min']);
  });

  it('restores after an application error and preserves original SQL failure', async () => {
    for (const abortSql of [false, true]) {
      let calls = 0;
      const original = new Error('original');
      const tx = {
        execute: async () => {
          calls++;
          if (calls === 3 && abortSql) throw new Error('transaction aborted');
          return [{ role: 'none', org: null, profile: null, timeout: '0' }];
        },
      } as unknown as CoreTx;
      await expect(
        withOrgCoreTransaction({ tenantId: 'org' }, tx, async () => {
          throw original;
        }),
      ).rejects.toBe(original);
      expect(calls).toBe(3);
    }
  });
});

describe('withOrgCore', () => {
  it('throws on an empty tenantId (fail-closed)', () => {
    // synchronous guard, mirrors withOrg — never opens a txn without an org
    expect(() => withOrgCore(fakeScope(''), async () => 1)).toThrow(/tenantId/);
  });

  it('runs ALL txn setup in a single statement (one round trip) and returns fn result', async () => {
    const out = await withOrgCore(fakeScope('21e0601b-f632-43fd-8414-d644af4271f4'), async (tx) => {
      expect(tx).toBeDefined();
      return 'ok';
    });
    expect(out).toBe('ok');
    // Perf contract: idle-in-txn guard + role + org GUC + profile GUC batched
    // into ONE execute — each extra statement is a full WAN round trip on every
    // org-scoped read. If setup grows, extend the single SELECT, don't add
    // statements.
    expect(executed.length).toBe(1);
    const setup = executed[0];
    for (const guc of [
      'idle_in_transaction_session_timeout',
      "'role'",
      'app.current_org_id',
      'app.current_profile_id',
    ]) {
      expect(setup).toContain(guc);
    }
  });

  it('runs the setup statement before the callback body', async () => {
    const order: string[] = [];
    await withOrgCore(fakeScope('org-x'), async () => {
      order.push('fn');
      expect(executed.length).toBe(1); // setup already ran
    });
    expect(order).toEqual(['fn']);
  });

  it('records a failed callback as one database transaction', async () => {
    const snapshot = await runWithPerformanceContext(createPerformanceContext(), async () => {
      await expect(
        withOrgCore(fakeScope('org-x'), async () => {
          throw new Error('query failed');
        }),
      ).rejects.toThrow('query failed');
      return currentPerformanceSnapshot();
    });

    expect(snapshot.database.transactions).toBe(1);
  });
});

describe('withOrgCore joined to an ambient transaction', () => {
  /** A CoreTx stand-in: answers the scope-capture SELECT and records queries. */
  function fakeAmbientTx(onExecute?: (q: SQL) => void) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: async (query: SQL) => {
        queries.push(new PgDialect().sqlToQuery(query));
        onExecute?.(query);
        return [{ role: 'none', org: null, profile: null, timeout: '0' }];
      },
      rollback: () => {
        throw new Error('rollback');
      },
    } as unknown as CoreTx;
    return { tx, queries };
  }

  /** The owner's half of the handshake: a release request ends the txn. */
  function ownedAmbient(tenantId: string, profileId: string | null, tx: CoreTx) {
    const owner = createAmbientOrgTx(tx, tenantId, profileId);
    void owner.releaseRequested.then(() => {
      owner.ambient.closed = true;
      owner.markEnded();
    });
    return owner;
  }

  it('runs on the shared transaction without BEGIN/setup/COMMIT', async () => {
    const { tx, queries } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', 'actor-1', tx);
    const scope = fakeScope('org-a');
    (scope as { profileId?: string }).profileId = 'actor-1';

    const seen = await owner.run(() => withOrgCore(scope, async (received) => received));

    expect(seen).toBe(tx);
    expect(queries).toHaveLength(0); // no transaction-setup statement
    expect(executed).toHaveLength(0); // the private path never opened a txn
  });

  it('counts a joined call as one database transaction with no acquire/setup', async () => {
    const { tx } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', null, tx);
    const snapshot = await runWithPerformanceContext(createPerformanceContext(), async () => {
      await owner.run(() => withOrgCore(fakeScope('org-a'), async () => 1));
      return currentPerformanceSnapshot();
    });
    expect(snapshot.database.transactions).toBe(1);
    expect(snapshot.database.acquireMs).toBe(0);
    expect(snapshot.database.setupMs).toBe(0);
  });

  it('re-scopes the shared transaction for a different org instead of opening a private one', async () => {
    const { tx, queries } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', 'actor-1', tx);

    await owner.run(() => withOrgCore(fakeScope('org-b'), async () => 'ok'));

    // capture + set + restore on the SAME transaction (withOrgCoreTransaction),
    // never a private BEGIN: the RLS pool has a single connection and this
    // request is holding it.
    expect(queries).toHaveLength(3);
    expect(queries[1]?.params).toEqual(['org-b', '']);
    expect(executed).toHaveLength(0);
  });

  it('re-scopes for a different acting profile too', async () => {
    const { tx, queries } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', 'actor-1', tx);
    const scope = fakeScope('org-a');
    (scope as { profileId?: string }).profileId = 'actor-2';

    await owner.run(() => withOrgCore(scope, async () => 'ok'));

    expect(queries[1]?.params).toEqual(['org-a', 'actor-2']);
    expect(executed).toHaveLength(0);
  });

  it('poisons the shared transaction when a joined callback fails, and rethrows', async () => {
    const { tx } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', null, tx);
    const boom = new Error('undefined_table');

    await expect(
      owner.run(() =>
        withOrgCore(fakeScope('org-a'), async () => {
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);
    expect(owner.ambient.poisoned).toBe(true);
    expect(executed).toHaveLength(0); // no retry for a non-25P02 failure
  });

  it('falls back to a private transaction once the store is poisoned', async () => {
    const { tx } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', null, tx);
    owner.ambient.poisoned = true;

    expect(await owner.run(() => withOrgCore(fakeScope('org-a'), async () => 'private'))).toBe(
      'private',
    );
    expect(executed).toHaveLength(1); // the private path's setup statement
    expect(owner.ambient.closed).toBe(true); // released the shared connection first
  });

  it('retries a 25P02 statement ONCE in a private transaction', async () => {
    const { tx } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', null, tx);
    const aborted = Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
    let attempts = 0;

    const result = await owner.run(() =>
      withOrgCore(fakeScope('org-a'), async () => {
        attempts += 1;
        if (attempts === 1) throw aborted;
        return 'retried';
      }),
    );

    expect(result).toBe('retried');
    expect(attempts).toBe(2);
    expect(owner.ambient.poisoned).toBe(true);
    expect(executed).toHaveLength(1); // exactly one private transaction
  });

  it('uses the private path once the shared transaction has closed', async () => {
    const { tx } = fakeAmbientTx();
    const owner = ownedAmbient('org-a', null, tx);
    owner.ambient.closed = true;

    await owner.run(() => withOrgCore(fakeScope('org-a'), async () => 1));
    expect(executed).toHaveLength(1);
  });

  it('leaves a non-POS (no ambient store) call on the private path', async () => {
    await withOrgCore(fakeScope('org-a'), async () => 1);
    expect(executed).toHaveLength(1);
  });
});
