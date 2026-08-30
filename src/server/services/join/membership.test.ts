import { describe, it, expect, vi, beforeEach } from 'vitest';

// createMembership now writes only the Supabase `organization_members` row.
const { upsert, from, hasCanonicalMembership } = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ error: null }));
  return {
    upsert,
    from: vi.fn(() => ({ upsert })),
    hasCanonicalMembership: vi.fn(async () => false),
  };
});
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from }) }));
vi.mock('$server/services/canonical-directory.service', () => ({ hasCanonicalMembership }));

import { createMembership, hasAnyMembership, isOrgMember } from './membership';

beforeEach(() => vi.clearAllMocks());

describe('createMembership', () => {
  it('upserts organization_members for a user with a supabaseId', async () => {
    await createMembership(
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
      { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'p-uuid' },
      'org1',
      'user',
    );
    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.role).toBe('member');
  });

  it('throws when supabaseId is missing (Supabase is the sole auth store)', async () => {
    await expect(
      createMembership({ id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user'),
    ).rejects.toThrow(/supabaseId is required/);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('membership reads', () => {
  it('uses the canonical database for any-membership checks', async () => {
    hasCanonicalMembership.mockResolvedValueOnce(true);

    await expect(hasAnyMembership('profile-1')).resolves.toBe(true);
    expect(hasCanonicalMembership).toHaveBeenCalledWith('profile-1');
  });

  it('uses the canonical database for organization-scoped checks', async () => {
    hasCanonicalMembership.mockResolvedValueOnce(true);

    await expect(isOrgMember('profile-1', 'org-1')).resolves.toBe(true);
    expect(hasCanonicalMembership).toHaveBeenCalledWith('profile-1', 'org-1');
  });

  it('propagates database failures instead of reporting a false non-member', async () => {
    hasCanonicalMembership.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(hasAnyMembership('profile-1')).rejects.toThrow('database unavailable');
  });
});
