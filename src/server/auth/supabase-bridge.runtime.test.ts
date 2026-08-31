import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadCanonicalMemberships, loadCanonicalProfile } = vi.hoisted(() => ({
  loadCanonicalMemberships: vi.fn(),
  loadCanonicalProfile: vi.fn(),
}));

vi.mock('$server/supabase', () => ({ supabaseServer: vi.fn() }));
vi.mock('$server/services/canonical-directory.service', () => ({
  loadCanonicalMemberships,
  loadCanonicalProfile,
}));

import { resolveSupabaseTenant } from './supabase-bridge.runtime';

beforeEach(() => vi.clearAllMocks());

describe('resolveSupabaseTenant', () => {
  const memberships = [
    { id: 'org-a', name: 'Alpha', slug: null, kind: 'business', role: 'owner' },
    { id: 'org-b', name: 'Beta', slug: null, kind: 'personal', role: 'owner' },
  ];

  it('honors a preferred organization only when it is a real membership', async () => {
    loadCanonicalMemberships.mockResolvedValueOnce(memberships);

    await expect(resolveSupabaseTenant('profile-1', 'org-b')).resolves.toEqual({
      orgId: 'org-b',
      kind: 'personal',
    });
  });

  it('falls back deterministically and preserves unknown-kind fail-closed behavior', async () => {
    loadCanonicalMemberships.mockResolvedValueOnce([
      { id: 'org-a', name: 'Alpha', slug: null, kind: 'unexpected', role: 'owner' },
    ]);

    await expect(resolveSupabaseTenant('profile-1', 'not-a-membership')).resolves.toEqual({
      orgId: 'org-a',
      kind: null,
    });
  });

  it('returns null for no memberships but propagates database failures', async () => {
    loadCanonicalMemberships.mockResolvedValueOnce([]);
    await expect(resolveSupabaseTenant('profile-1')).resolves.toBeNull();

    loadCanonicalMemberships.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(resolveSupabaseTenant('profile-1')).rejects.toThrow('database unavailable');
  });
});
