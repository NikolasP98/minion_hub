import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const requireCoreCtx = vi.fn();
const unreadCount = vi.fn();

vi.mock('$server/auth/authorize', () => ({ requireAuth }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx }));
vi.mock('$server/services/inbox/inbox.service', () => ({ unreadCount }));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  requireCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'user-1' });
});

describe('GET /api/inbox/count', () => {
  it('returns the service-resolved unread count', async () => {
    unreadCount.mockResolvedValue(4);
    const res = await GET!({ locals: {} } as never);
    expect(await res.json()).toEqual({ count: 4 });
    expect(unreadCount).toHaveBeenCalledWith({ db: {}, tenantId: 'org-1', profileId: 'user-1' });
  });
});
