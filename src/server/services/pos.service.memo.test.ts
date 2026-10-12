import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CoreTx } from '$server/db/with-org-core';
import { withRequestMemo } from '$server/db/request-memo';

// pos.service.ts has no pre-existing plain unit-test file (only the banned
// *.sql.integration.test.ts) — this one is scoped narrowly to the
// request-memo wrap added in debloat-c §3 (listOpenShifts), not the whole
// module's business logic.
const ROWS = [{ id: 'shift-1', openedBy: 'user-1', openedAt: new Date('2026-01-01') }];

const fakeTx = () => {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => Promise.resolve(ROWS)),
  };
  return chain as unknown as CoreTx;
};

const withOrgCoreMock = vi.fn((_ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => fn(fakeTx()));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => withOrgCoreMock(ctx, fn),
}));

const ctx: CoreCtx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  withOrgCoreMock.mockImplementation((_ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => fn(fakeTx()));
});

describe('pos.service.ts listOpenShifts request-scoped memoisation (debloat-c §3)', () => {
  it('shares one read across repeated calls within one request-memo store', async () => {
    const { listOpenShifts } = await import('./pos.service');

    const [a, b] = await withRequestMemo(() =>
      Promise.all([listOpenShifts(ctx), listOpenShifts(ctx)]),
    );

    expect(a).toEqual(ROWS);
    expect(b).toEqual(ROWS);
    expect(withOrgCoreMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches every call outside a request-memo store (unchanged write-path behavior)', async () => {
    const { listOpenShifts } = await import('./pos.service');

    await listOpenShifts(ctx);
    await listOpenShifts(ctx);

    expect(withOrgCoreMock).toHaveBeenCalledTimes(2);
  });

  it('two different orgs never share a cache entry', async () => {
    const { listOpenShifts } = await import('./pos.service');
    const ctxB: CoreCtx = { db: {} as never, tenantId: 'org-2' };

    await withRequestMemo(() => Promise.all([listOpenShifts(ctx), listOpenShifts(ctxB)]));

    expect(withOrgCoreMock).toHaveBeenCalledTimes(2);
  });
});
