import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn() }));
vi.mock('../fresh-org-authority', () => ({
  resolveFreshOrgMembersWithCapability: mocks.list,
  resolveFreshOrgMemberWithCapability: mocks.one,
}));

import { prepareJoinReviewRecipients, recheckJoinReviewRecipient } from './notification-audience';

describe('join notification audience', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.one.mockReset();
  });

  it('uses exact users:manage authority and case-insensitively deduplicates verified addresses', async () => {
    mocks.list.mockResolvedValueOnce([
      { profileId: 'p1', verifiedEmail: 'manager@example.test' },
      { profileId: 'p2', verifiedEmail: 'manager@example.test' },
      { profileId: 'p3', verifiedEmail: null },
    ]);
    await expect(prepareJoinReviewRecipients('org-a')).resolves.toEqual([
      { profileId: 'p1', email: 'manager@example.test' },
    ]);
    expect(mocks.list).toHaveBeenCalledWith('org-a', 'users', 'manage');
  });

  it('admits only the same current member and unchanged verified destination', async () => {
    const candidate = { profileId: 'p1', email: 'manager@example.test' };
    mocks.one.mockResolvedValueOnce({ profileId: 'p1', verifiedEmail: 'manager@example.test' });
    await expect(recheckJoinReviewRecipient('org-a', candidate)).resolves.toBe(true);
    mocks.one.mockResolvedValueOnce({ profileId: 'p1', verifiedEmail: 'new@example.test' });
    await expect(recheckJoinReviewRecipient('org-a', candidate)).resolves.toBe(false);
    mocks.one.mockResolvedValueOnce(null);
    await expect(recheckJoinReviewRecipient('org-a', candidate)).resolves.toBe(false);
    expect(mocks.one).toHaveBeenCalledWith('org-a', 'p1', 'users', 'manage');
  });
});
