import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CoreTx } from '$server/db/with-org-core';
import { withRequestMemo } from '$server/db/request-memo';

// This row is what every one of getPosSettings/getPosSettingsInTx/
// getPosCurrencyInTx should see once it's memoised — a single underlying
// `select * from pos_settings where org_id = …` (debloat-c §3).
const ROW = {
  orgId: 'org-1',
  currency: 'PEN',
  methods: ['cash'],
  requireCustomer: false,
  allowPriceOverride: true,
  emission: { mode: 'off', docTypeDefault: '03' },
  requirements: {},
  updatedAt: new Date('2026-01-01'),
};

const fakeTx = () => {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([ROW])),
  };
  return chain as unknown as CoreTx;
};

const withOrgCoreMock = vi.fn((ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => fn(fakeTx()));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => withOrgCoreMock(ctx, fn),
}));

const lockPosSettingsShared = vi.fn(async () => undefined);
vi.mock('./lock-key', () => ({
  lockPosSettingsShared,
  lockPosSettingsExclusive: vi.fn(),
}));

const ctx: CoreCtx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  withOrgCoreMock.mockImplementation((_ctx: CoreCtx, fn: (tx: CoreTx) => unknown) => fn(fakeTx()));
});

describe('pos/settings.ts request-scoped memoisation (debloat-c §3)', () => {
  it('shares one underlying read across getPosSettings/getPosSettingsInTx/getPosCurrencyInTx within one request', async () => {
    const { getPosSettings, getPosSettingsInTx, getPosCurrencyInTx } = await import('./settings');
    const tx = fakeTx();

    const [settings, settingsInTx, currency] = await withRequestMemo(() =>
      Promise.all([
        getPosSettings(ctx),
        getPosSettingsInTx(tx, 'org-1'),
        getPosCurrencyInTx(tx, 'org-1'),
      ]),
    );

    expect(settings.currency).toBe('PEN');
    expect(settingsInTx.currency).toBe('PEN');
    expect(currency).toBe('PEN');
    // One real fetch total: withOrgCore ran once (getPosSettings's own
    // transaction), and the *InTx variants reused that settled row.
    expect(withOrgCoreMock).toHaveBeenCalledTimes(1);
  });

  it("getPosSettingsInTx uses the CALLER's tx on the first (real) execution", async () => {
    const { getPosSettingsInTx } = await import('./settings');
    const tx = fakeTx();

    await withRequestMemo(() => getPosSettingsInTx(tx, 'org-1'));

    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(lockPosSettingsShared).toHaveBeenCalledWith(tx, 'org-1');
  });

  it('a later getPosSettingsInTx call in the same request does not touch its own tx or re-acquire the lock', async () => {
    const { getPosSettingsInTx } = await import('./settings');
    const firstTx = fakeTx();
    const secondTx = fakeTx();

    await withRequestMemo(async () => {
      await getPosSettingsInTx(firstTx, 'org-1');
      await getPosSettingsInTx(secondTx, 'org-1');
    });

    expect(firstTx.select).toHaveBeenCalledTimes(1);
    expect(secondTx.select).not.toHaveBeenCalled();
    // Only the first call's lock was acquired — the second is a pure cache hit.
    expect(lockPosSettingsShared).toHaveBeenCalledTimes(1);
  });

  it('without an active request-memo store (e.g. a write request), every call re-fetches — unchanged from before this change', async () => {
    const { getPosSettings } = await import('./settings');

    await getPosSettings(ctx);
    await getPosSettings(ctx);

    expect(withOrgCoreMock).toHaveBeenCalledTimes(2);
  });
});
