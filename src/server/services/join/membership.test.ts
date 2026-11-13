import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  hasCanonicalMembership,
  admitLegacyMembership,
  invalidateRbac,
  loadOrganizationRolePolicy,
} = vi.hoisted(() => ({
  hasCanonicalMembership: vi.fn(async () => false),
  admitLegacyMembership: vi.fn(async () => undefined),
  invalidateRbac: vi.fn(async () => undefined),
  loadOrganizationRolePolicy: vi.fn(async () => ({ roleModel: 'legacy', defaultRoleKey: null })),
}));
vi.mock('$server/services/organization-role-policy', () => ({ loadOrganizationRolePolicy }));
vi.mock('./profile-admission', () => ({ admitLegacyMembership }));
vi.mock('$server/services/canonical-directory.service', () => ({ hasCanonicalMembership }));
vi.mock('$server/services/rbac.service', () => ({ invalidateRbac }));
import { createMembership, hasAnyMembership, isOrgMember } from './membership';
beforeEach(() => vi.clearAllMocks());

describe('createMembership', () => {
  it('admits the exact selected legacy admin role through the atomic membership boundary', async () => {
    await createMembership(
      { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'profile-1' },
      'org-1',
      'admin',
      'grantor-profile',
    );
    expect(admitLegacyMembership).toHaveBeenCalledWith(
      'org-1',
      'profile-1',
      'admin',
      'grantor-profile',
    );
    expect(invalidateRbac).toHaveBeenCalledWith('org-1');
  });
  it('retains the selected staff role instead of substituting a legacy manager fallback', async () => {
    await createMembership(
      { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'profile-1' },
      'org-1',
      'staff',
      'grantor-profile',
    );
    expect(admitLegacyMembership).toHaveBeenCalledWith(
      'org-1',
      'profile-1',
      'staff',
      'grantor-profile',
    );
  });
  it('does not invalidate a grant that failed to commit', async () => {
    admitLegacyMembership.mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      createMembership(
        { id: 'u1', email: 'a@b.c', displayName: 'A', supabaseId: 'profile-1' },
        'org-1',
        'staff',
        'grantor-profile',
      ),
    ).rejects.toThrow('commit failed');
    expect(invalidateRbac).not.toHaveBeenCalled();
  });
  it('refuses direct membership creation without authenticated grantor provenance', async () => {
    await expect(
      createMembership(
        { id: 'u1', email: 'a@b.c', displayName: null, supabaseId: 'profile-1' },
        'org-1',
        'admin',
      ),
    ).rejects.toThrow('Authenticated grantor profile required');
    expect(admitLegacyMembership).not.toHaveBeenCalled();
  });
  it('throws before mutation when the Supabase profile identity is missing', async () => {
    await expect(
      createMembership({ id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org-1', 'staff'),
    ).rejects.toThrow(/supabaseId is required/);
    expect(admitLegacyMembership).not.toHaveBeenCalled();
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
