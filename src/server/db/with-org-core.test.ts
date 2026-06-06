import { describe, it, expect, beforeEach } from 'vitest';
import { withOrgCore } from './with-org-core';

// withOrgCore transacts on the scope's own db handle, so we pass a fake scope
// whose db.transaction passes a tx through and records the executed setup SQL.
const executed: string[] = [];

function fakeScope(tenantId: string) {
  const tx = {
    execute: async (q: unknown) => {
      executed.push(String(q));
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

  it('runs two setup statements (role + GUC) inside the txn and returns fn result', async () => {
    const out = await withOrgCore(fakeScope('21e0601b-f632-43fd-8414-d644af4271f4'), async (tx) => {
      expect(tx).toBeDefined();
      return 'ok';
    });
    expect(out).toBe('ok');
    // exactly the SET LOCAL ROLE + set_config(app.current_org_id) statements
    expect(executed.length).toBe(2);
  });

  it('runs the role/GUC statements before the callback body', async () => {
    const order: string[] = [];
    await withOrgCore(fakeScope('org-x'), async () => {
      order.push('fn');
      expect(executed.length).toBe(2); // setup already ran
    });
    expect(order).toEqual(['fn']);
  });
});
