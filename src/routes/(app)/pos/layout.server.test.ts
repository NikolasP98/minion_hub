import { describe, it, expect, vi } from 'vitest';

/**
 * Regression for the side-menu Accounts badge going stale after scheduling a
 * pending line: this load computes `posPendingScheduling` but only declared
 * `depends('pos:shift')`, so `invalidate('pos:pending')` (or any other key)
 * anywhere else in the app could never make it rerun. See
 * `+layout.server.ts` and the `onbooked` fix in `appointments/new/+page.svelte`.
 */
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1', profileId: 'p-1' }),
}));
vi.mock('$server/services/pos.service', () => ({
  getPosSettings: () => Promise.resolve({ methods: [] }),
  getOpenShift: () => Promise.resolve(null),
}));
vi.mock('$server/services/user.service', () => ({
  getUser: () => Promise.resolve(null),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  countPendingSchedulingLines: () => Promise.resolve(3),
}));

async function call(dependsSpy: (key: string) => void) {
  const { load } = await import('./+layout.server');
  return load({
    locals: { moduleStates: { stock: true, scheduling: true } },
    depends: dependsSpy,
  } as unknown as Parameters<typeof load>[0]);
}

describe('/pos +layout.server load', () => {
  it('declares its OWN depends key for the pending-scheduling badge', async () => {
    const keys: string[] = [];
    const data = await call((k) => keys.push(k));
    expect(keys).toContain('pos:pending');
    expect(data).toMatchObject({ posPendingScheduling: 3 });
  });
});
