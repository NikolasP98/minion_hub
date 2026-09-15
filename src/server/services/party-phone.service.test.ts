import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `setPartyPhone` — the write behind the till's "add phone" affordance.
 *
 * The parties spine stores the last-9-digits key, not the typed string, and
 * that column is ALSO a dedup key (`ensureParty` matches on it). A counter-typed
 * "+51 992 376 833" and a harvested WhatsApp number must therefore land on the
 * same value, or the same client splits into two parties.
 */
const invalidateMock = vi.fn<() => Promise<void>>(async () => {});
vi.mock('@minion-stack/cache', () => ({
  invalidateTags: () => invalidateMock(),
  tags: { tenantDomain: () => ['crm'] },
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx),
}));

let setValues: Record<string, unknown> = {};
let returned: Array<{ phone9: string | null }> = [];
const tx = {
  update: () => ({
    set: (v: Record<string, unknown>) => {
      setValues = v;
      return { where: () => ({ returning: () => Promise.resolve(returned) }) };
    },
  }),
};

import { setPartyPhone } from './party.service';

const ctx = { db: {} as never, tenantId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
  setValues = {};
  returned = [{ phone9: '992376833' }];
});

describe('setPartyPhone', () => {
  it('stores the phone9 key, not the typed string', async () => {
    expect(await setPartyPhone(ctx, 'party-1', '+51 992 376 833')).toBe('992376833');
    expect(setValues.phone9).toBe('992376833');
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a number too short to be a key, without touching the row', async () => {
    expect(await setPartyPhone(ctx, 'party-1', '1234567')).toBeNull();
    expect(setValues).toEqual({});
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('answers null when no party in this org has that id', async () => {
    returned = [];
    expect(await setPartyPhone(ctx, 'party-9', '992376833')).toBeNull();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
