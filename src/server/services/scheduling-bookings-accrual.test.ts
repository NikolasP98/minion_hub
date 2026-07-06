import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const accrueMock = vi.fn<(ctx: unknown, input: unknown) => Promise<number>>(async () => 1);
const releaseMock = vi.fn<(ctx: unknown, s: string, id: string) => Promise<number>>(async () => 1);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: (ctx: unknown, input: unknown) => accrueMock(ctx, input),
  releaseAccruals: (ctx: unknown, s: string, id: string) => releaseMock(ctx, s, id),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { setBookingStatus } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('setBookingStatus — accrual release hook', () => {
  it.each(['cancelled', 'rejected', 'no_show'])('releases open accruals on %s', async (status) => {
    const { db } = createMockDb();
    await setBookingStatus(ctx(db), 'b1', status);
    expect(releaseMock).toHaveBeenCalledWith(expect.anything(), 'booking', 'b1');
  });

  it('does NOT release on accepted/completed', async () => {
    const { db } = createMockDb();
    await setBookingStatus(ctx(db), 'b1', 'accepted');
    await setBookingStatus(ctx(db), 'b1', 'completed');
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('a release failure never fails the status change', async () => {
    releaseMock.mockRejectedValueOnce(new Error('db down'));
    const { db } = createMockDb();
    await expect(setBookingStatus(ctx(db), 'b1', 'cancelled')).resolves.toBeUndefined();
  });
});
