import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshPulse = vi.fn(async () => {});
vi.mock('./pulse.svelte', () => ({
  pulse: { pendingCount: 0, refreshCount: refreshPulse },
}));
vi.mock('$lib/state/gateway/update-state.svelte', () => ({
  updateState: { pending: false },
}));

const { subscribeNotificationsPolling, notifications } = await import('./notifications.svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refreshPulse.mockClear();
});

/** Routes by URL — one poll cycle now fires join-requests/count AND inbox/count
 *  (still ONE coalesced cycle via refreshNotifications, just two fetches in it). */
function stubCountFetch(counts: { pending: number; inbox: number }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({ count: url.includes('/api/inbox/count') ? counts.inbox : counts.pending }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('notification polling coordinator', () => {
  it('shares one initial refresh and interval across both shell subscribers', async () => {
    vi.useFakeTimers();
    const fetchMock = stubCountFetch({ pending: 0, inbox: 0 });

    const unsubscribeTopbar = subscribeNotificationsPolling();
    const unsubscribeIsland = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshPulse).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(refreshPulse).toHaveBeenCalledTimes(2);

    unsubscribeTopbar();
    unsubscribeIsland();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('adds the inbox unread count into the bell badge total', async () => {
    vi.useFakeTimers();
    stubCountFetch({ pending: 2, inbox: 5 });

    const unsubscribe = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications.pendingCount).toBe(2);
    expect(notifications.inboxUnreadCount).toBe(5);
    // badgeCount = pendingCount + pulse.pendingCount(0) + update(0) + inboxUnreadCount
    expect(notifications.badgeCount).toBe(7);

    unsubscribe();
  });
});
