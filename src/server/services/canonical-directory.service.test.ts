import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => query }));

import {
  hasCanonicalMembership,
  loadCanonicalMemberships,
  loadCanonicalProfile,
} from './canonical-directory.service';

beforeEach(() => vi.clearAllMocks());

describe('canonical directory', () => {
  it('loads the complete profile used by the auth bridge', async () => {
    const profile = {
      id: '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6',
      email: 'nikolas.pinon98@gmail.com',
      display_name: 'Nikolas Sarria',
      role: 'admin',
      avatar_url: null,
      created_at: '2026-05-26T00:31:21.009Z',
      username: null,
    };
    query.mockResolvedValueOnce([profile]);

    await expect(loadCanonicalProfile(profile.id)).resolves.toEqual(profile);
  });

  it('retries only a missing enrichment column with the core profile', async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error('column missing'), { code: '42703' }))
      .mockResolvedValueOnce([
        {
          id: '3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6',
          email: 'nikolas.pinon98@gmail.com',
          display_name: 'Nikolas Sarria',
          role: 'admin',
        },
      ]);

    await expect(
      loadCanonicalProfile('3ab72ffb-6cac-4933-b35e-cd12aa7ccbd6'),
    ).resolves.toMatchObject({
      role: 'admin',
      avatar_url: null,
      created_at: null,
      username: null,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns ordered canonical memberships without a PostgREST dependency', async () => {
    const memberships = [
      { id: 'org-a', name: 'Bernibites', slug: null, kind: 'business', role: 'owner' },
      { id: 'org-b', name: 'MINION', slug: 'minion', kind: 'business', role: 'owner' },
    ];
    query.mockResolvedValueOnce(memberships);

    await expect(loadCanonicalMemberships('profile-1')).resolves.toEqual(memberships);
  });

  it('distinguishes no membership from a database error', async () => {
    query.mockResolvedValueOnce([]);
    await expect(hasCanonicalMembership('profile-1')).resolves.toBe(false);

    query.mockRejectedValueOnce(new Error('connection failed'));
    await expect(hasCanonicalMembership('profile-1')).rejects.toThrow('connection failed');
  });
});
