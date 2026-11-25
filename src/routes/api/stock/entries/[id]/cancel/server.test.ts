import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionError } from '$server/services/stock-corrections.logic';

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), log: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'me' }),
}));
vi.mock('$server/services/stock.service', () => ({
  cancelEntry: (...a: unknown[]) => mocks.cancel(...a),
  StockError: class StockError extends Error {},
}));
vi.mock('$server/services/record-locks.service', () => ({
  logLockEvent: (...a: unknown[]) => mocks.log(...a),
  personActor: () => ({ kind: 'person', id: null, name: 'Ada' }),
}));
import { POST } from './+server';

const call = () =>
  POST({
    locals: { user: { displayName: 'Ada' } },
    params: { id: 'e1' },
  } as never) as Promise<Response>;
const hit = { rule: 'month', kind: 'month', unlockable: true, period: '2026-09' };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/stock/entries/:id/cancel (spec 140)', () => {
  it('answers a locked receipt with the refusal shape and logs it', async () => {
    mocks.cancel.mockRejectedValue(
      new CorrectionError('period 2026-09 is locked', 'period_locked', { locks: [hit] }),
    );
    const res = await call();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'period_locked',
      outcome: 'not_applied',
      locks: [hit],
      unlockBy: 'owner',
    });
    expect(mocks.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'refused',
        recordType: 'stock_receipt',
        recordId: 'e1',
        rules: [hit],
      }),
      { dedupeMs: 600_000 },
    );
  });

  it('returns the cancelled entry when nothing locks it', async () => {
    mocks.cancel.mockResolvedValue({ id: 'e1', status: 'cancelled' });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
