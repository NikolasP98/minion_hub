import { describe, it, expect, vi } from 'vitest';

/**
 * Regression for the side-menu Accounts badge going stale after scheduling a
 * pending line: this load computes `posPendingWork` but only declared
 * `depends('pos:shift')`, so `invalidate('pos:pending')` (or any other key)
 * anywhere else in the app could never make it rerun. See
 * `+layout.server.ts` and the `onbooked` fix in `appointments/new/+page.svelte`.
 */
const posService = vi.hoisted(() => ({
  getPosSettings: vi.fn(() => Promise.resolve({ methods: [] })),
}));
const denied = vi.hoisted(() => ({ value: false }));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: () =>
    Promise.resolve(
      denied.value
        ? { denied: 'pos', verb: 'view' }
        : { db: {}, tenantId: 'org-1', profileId: 'p-1' },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/pos.service', () => ({
  getPosSettings: posService.getPosSettings,
  getOpenShift: () => Promise.resolve(null),
  listOpenShifts: () => Promise.resolve([]),
}));
vi.mock('$server/services/user.service', () => ({
  getUserNames: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  countPosPendingWork: () => Promise.resolve(3),
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
    expect(data).toMatchObject({ posPendingWork: 3 });
  });

  it('a role without pos:view gets the marker in every POS slot and no service runs', async () => {
    denied.value = true;
    posService.getPosSettings.mockClear();
    try {
      const data = (await call(() => {})) as Record<string, unknown>;
      for (const slot of [data.posSettings, data.openShift, data.openShifts, data.posPendingWork]) {
        expect(slot).toEqual({ denied: 'pos', verb: 'view' });
      }
      expect(posService.getPosSettings).not.toHaveBeenCalled();
    } finally {
      denied.value = false;
    }
  });
});
