import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { StaleWriteError } from './errors';

const CUR_ROW = {
  id: 'o1',
  orgId: 'org-1',
  status: 'draft',
  updatedAt: new Date('2026-06-01T00:00:00Z'),
};

/** Hand-rolled tx mock (same technique as audit-coverage.test.ts): the update
 *  chain's terminal `.returning()` is parameterized per test to simulate a
 *  matched (row returned) vs stale (0 rows) WHERE — real epoch-ms evaluation
 *  only happens against a live Postgres, so this exercises the service's
 *  branch on the DB's 0-vs-1-row outcome, which is what §C's logic hinges on. */
function buildTx(updateMatches: boolean) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([CUR_ROW]) }) }),
  }));
  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(updateMatches ? [{ ...CUR_ROW, status: 'confirmed' }] : []),
      }),
    }),
  }));
  const insert = vi.fn(() => ({ values: () => Promise.resolve(undefined) }));
  const execute = vi.fn().mockResolvedValue(undefined);
  return { select, update, insert, execute };
}

function ctxWithTx(tx: unknown) {
  return { db: { transaction: (cb: (t: unknown) => unknown) => cb(tx) }, tenantId: 'org-1' } as never;
}

describe('optimistic locking (§C, sales.service.setOrderStatus)', () => {
  it('stale expectedUpdatedAt (0 rows updated) throws StaleWriteError carrying the current row', async () => {
    const { setOrderStatus } = await import('./sales.service');
    const tx = buildTx(false);
    await expect(
      setOrderStatus(ctxWithTx(tx), 'o1', 'confirmed', undefined, new Date('2020-01-01T00:00:00Z')),
    ).rejects.toSatisfy((e: unknown) => e instanceof StaleWriteError && e.current === CUR_ROW);
  });

  it('matching expectedUpdatedAt updates successfully', async () => {
    const { setOrderStatus } = await import('./sales.service');
    const tx = buildTx(true);
    const row = await setOrderStatus(ctxWithTx(tx), 'o1', 'confirmed', undefined, CUR_ROW.updatedAt);
    expect(row?.status).toBe('confirmed');
  });

  it('omitted expectedUpdatedAt updates successfully (backward compat)', async () => {
    const { setOrderStatus } = await import('./sales.service');
    const tx = buildTx(true);
    const row = await setOrderStatus(ctxWithTx(tx), 'o1', 'confirmed');
    expect(row?.status).toBe('confirmed');
  });
});
