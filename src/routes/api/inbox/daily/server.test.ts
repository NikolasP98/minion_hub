import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const requireCoreCtx = vi.fn();
const requestDailyKnock = vi.fn();

vi.mock('$server/auth/authorize', () => ({ requireAuth }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx }));
vi.mock('$server/services/inbox/daily-feed.service', () => ({ requestDailyKnock }));
vi.mock('$lib/paraglide/messages', () => ({ inbox_daily_title: () => 'Tu día' }));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  requireCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'user-1' });
});

describe('POST /api/inbox/daily', () => {
  it('reports created:true on the first call of the org-local day', async () => {
    requestDailyKnock.mockResolvedValue({ created: true });
    const res = await POST!({ locals: {} } as never);
    expect(await res.json()).toEqual({ created: true });
  });

  it('is idempotent — a second call the same day reports created:false', async () => {
    requestDailyKnock.mockResolvedValueOnce({ created: true });
    requestDailyKnock.mockResolvedValueOnce({ created: false });

    const first = await POST!({ locals: {} } as never);
    const second = await POST!({ locals: {} } as never);

    expect(await first.json()).toEqual({ created: true });
    expect(await second.json()).toEqual({ created: false });
    expect(requestDailyKnock).toHaveBeenCalledTimes(2);
  });
});
