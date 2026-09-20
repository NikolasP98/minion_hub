import { describe, expect, it, vi } from 'vitest';
import type { SeedContext } from './db';
import { MATRIX } from './matrix';
import { IDENTITY_FIXTURES, seed } from './pos-identity';

describe('identity-required POS fixture admission', () => {
  it('does not write anything if the existing QA owner is absent', async () => {
    const sql = Object.assign(
      vi.fn(async () => []),
      { begin: vi.fn() },
    );
    await expect(
      seed({ sql: sql as unknown as SeedContext['sql'], register: vi.fn() }),
    ).rejects.toThrow('Seed the QA owner');
    expect(sql.begin).not.toHaveBeenCalled();
  });
  it('registers every promised fixture and scopes all inserts to the identity organization', async () => {
    const tx = Object.assign(
      vi.fn(async () => []),
      { json: (value: unknown) => value },
    );
    const sql = Object.assign(
      vi.fn(async () => [{ id: 'seeded-owner' }]),
      { begin: async (fn: (client: unknown) => Promise<void>) => fn(tx) },
    );
    const register = vi.fn();
    await seed({ sql: sql as unknown as SeedContext['sql'], register });
    expect(register.mock.calls.map(([id]) => id).sort()).toEqual(
      MATRIX.filter((entry) => entry.id.startsWith('pos.identity.'))
        .map((entry) => entry.id)
        .sort(),
    );
    for (const call of tx.mock.calls as unknown[][]) {
      if (String(call[0]).includes('insert into')) expect(call).toContain(IDENTITY_FIXTURES.org);
    }
  });
});
