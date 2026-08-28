import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listOrganizations: vi.fn(),
}));

vi.mock('$server/auth/authorize', () => ({
  requireAdmin: (locals: unknown) => mocks.requireAdmin(locals),
}));
vi.mock('$server/services/organizations.service', () => ({
  listAllOrganizationsWithMemberCounts: () => mocks.listOrganizations(),
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: {
        select: () => typeof chain;
        order: () => typeof chain;
        then: (resolve: (v: { data: unknown[] }) => void) => void;
      } = {
        select: () => chain,
        order: () => chain,
        then: (resolve) => resolve({ data: [] }),
      };
      return chain;
    },
  }),
}));

import { load } from './+page.server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockReturnValue({ id: 'admin-1', role: 'admin' });
  mocks.listOrganizations.mockResolvedValue([{ id: 'org-1', name: 'MINION', slug: 'minion', members: 3 }]);
});

describe('/settings/organizations load', () => {
  it('requires platform admin before listing organizations', async () => {
    mocks.requireAdmin.mockImplementation(() => {
      throw { status: 403 };
    });
    await expect(load({ locals: {}, depends: vi.fn() } as never)).rejects.toMatchObject({ status: 403 });
    expect(mocks.listOrganizations).not.toHaveBeenCalled();
  });

  it('loads the admin organization inventory', async () => {
    const depends = vi.fn();
    await expect(load({ locals: {}, depends } as never)).resolves.toEqual({
      organizations: [{ id: 'org-1', name: 'MINION', slug: 'minion', members: 3 }],
      savedTraces: {},
      profiles: [],
    });
    expect(depends).toHaveBeenCalledWith('settings:organizations');
  });
});
