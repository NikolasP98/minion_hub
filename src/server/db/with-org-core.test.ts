import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture SQL executed inside the mocked transaction.
const executed: string[] = [];

vi.mock('./pg-client', () => ({
  getCoreDb: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async (q: unknown) => {
          executed.push(String(q));
        },
      }),
  }),
}));

import { withOrgCore } from './with-org-core';

beforeEach(() => {
  executed.length = 0;
});

describe('withOrgCore', () => {
  it('throws on an empty orgId (fail-closed)', () => {
    // synchronous guard, mirrors withOrg — never opens a txn without an org
    expect(() => withOrgCore('', async () => 1)).toThrow(/orgId/);
  });

  it('runs two setup statements (role + GUC) inside the txn and returns fn result', async () => {
    const out = await withOrgCore('21e0601b-f632-43fd-8414-d644af4271f4', async (tx) => {
      // tx is the transaction handle handed to the callback
      expect(tx).toBeDefined();
      return 'ok';
    });
    expect(out).toBe('ok');
    // exactly the SET LOCAL ROLE + set_config(app.current_org_id) statements
    expect(executed.length).toBe(2);
  });

  it('runs the role/GUC statements before the callback body', async () => {
    const order: string[] = [];
    await withOrgCore('org-x', async () => {
      order.push('fn');
      // setup already ran (both execute() calls awaited before fn)
      expect(executed.length).toBe(2);
    });
    expect(order).toEqual(['fn']);
  });
});
