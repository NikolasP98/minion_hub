import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), membership: vi.fn(), pending: vi.fn() }));
vi.mock('$server/auth/authorize', () => ({ requireAuth: mocks.auth }));
vi.mock('$server/services/join/membership', () => ({ hasAnyMembership: mocks.membership }));
vi.mock('$server/services/join/requests.service', () => ({
  getPendingRequestsForUser: mocks.pending,
}));
import { load } from './+page.server';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue({ id: 'own-user', supabaseId: 'own-profile' });
  mocks.membership.mockResolvedValue(false);
  mocks.pending.mockResolvedValue({ kind: 'none', requests: [], hasMore: false });
});
describe('own join waiting page', () => {
  it.each(['none', 'one', 'many'] as const)(
    'returns the explicit %s state for the authenticated applicant',
    async (kind) => {
      const pending = {
        kind,
        requests: Array.from({ length: kind === 'none' ? 0 : kind === 'one' ? 1 : 2 }, (_, i) => ({
          id: `own-${i}`,
          organizationName: `Workspace ${i}`,
          createdAt: '2026-10-03T00:00:00.000Z',
        })),
        hasMore: false,
      };
      mocks.pending.mockResolvedValue(pending);
      expect(
        await load({
          locals: {},
          url: new URL('http://localhost/join/sent?userId=foreign'),
        } as never),
      ).toEqual({ pending });
      expect(mocks.pending).toHaveBeenCalledWith('own-user');
    },
  );
  it('does not render a success claim when reads fail', async () => {
    mocks.pending.mockRejectedValue(new Error('Access requests unavailable'));
    await expect(load({ locals: {} } as never)).rejects.toThrow('Access requests unavailable');
  });
  it('sends an activated member home', async () => {
    mocks.membership.mockResolvedValue(true);
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 303,
      location: '/',
    });
    expect(mocks.pending).toHaveBeenCalledWith('own-user');
  });
  it('shows a pending workspace even when the applicant already belongs to another', async () => {
    mocks.membership.mockResolvedValue(true);
    const pending = {
      kind: 'one',
      requests: [{ id: 'b', organizationName: 'Workspace B', createdAt: '2026-10-03T00:00:00Z' }],
      hasMore: false,
    };
    mocks.pending.mockResolvedValue(pending);
    expect(await load({ locals: {} } as never)).toEqual({ pending });
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});
