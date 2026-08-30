import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadCanonicalMemberships } = vi.hoisted(() => ({
  loadCanonicalMemberships: vi.fn(),
}));

vi.mock('$server/supabase', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('$server/services/canonical-directory.service', () => ({ loadCanonicalMemberships }));

import { loadOrganizationsForUser } from './organizations.service';

beforeEach(() => vi.clearAllMocks());

describe('loadOrganizationsForUser', () => {
  it('loads organization choices from the canonical membership directory', async () => {
    loadCanonicalMemberships.mockResolvedValueOnce([
      { id: 'org-a', name: 'Alpha', slug: 'alpha', kind: 'business', role: 'owner' },
      { id: 'org-b', name: 'Beta', slug: null, kind: 'personal', role: 'member' },
    ]);

    const result = await loadOrganizationsForUser(
      {
        user: { supabaseId: 'profile-1' },
        session: null,
        tenantCtx: undefined,
      } as never,
      'ignored-legacy-id',
    );

    expect(result).toEqual({
      organizations: [
        { id: 'org-a', name: 'Alpha', slug: 'alpha', kind: 'business', role: 'owner' },
        { id: 'org-b', name: 'Beta', slug: null, kind: 'personal', role: 'member' },
      ],
      activeOrgId: 'org-a',
    });
  });

  it('does not hide canonical database failures as an empty organization list', async () => {
    loadCanonicalMemberships.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      loadOrganizationsForUser({ user: { supabaseId: 'profile-1' } } as never, 'ignored'),
    ).rejects.toThrow('database unavailable');
  });
});
