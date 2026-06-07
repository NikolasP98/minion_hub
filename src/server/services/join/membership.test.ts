import { describe, it, expect, vi, beforeEach } from 'vitest';

// createMembership now writes only the Supabase `organization_members` row.
const upsert = vi.fn(async () => ({ error: null }));
const from = vi.fn(() => ({ upsert }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));

import { createMembership } from './membership';

beforeEach(() => vi.clearAllMocks());

describe('createMembership', () => {
  it('upserts organization_members for a user with a supabaseId', async () => {
    await createMembership(
      {} as never,
      { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'p-uuid' },
      'org1',
      'admin',
    );
    expect(from).toHaveBeenCalledWith('organization_members');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(row).toEqual({ organization_id: 'org1', profile_id: 'p-uuid', role: 'admin' });
    expect(opts).toEqual({ onConflict: 'organization_id,profile_id' });
  });

  it('maps any non-admin role to member', async () => {
    await createMembership(
      {} as never,
      { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'p-uuid' },
      'org1',
      'user',
    );
    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.role).toBe('member');
  });

  it('throws when supabaseId is missing (Supabase is the sole auth store)', async () => {
    await expect(
      createMembership({} as never, { id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user'),
    ).rejects.toThrow(/supabaseId is required/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
