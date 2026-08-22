import { describe, it, expect, beforeEach } from 'vitest';
import { withOrgCore } from './with-org-core';

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
});
