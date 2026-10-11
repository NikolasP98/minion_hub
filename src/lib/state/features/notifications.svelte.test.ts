import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshPulse = vi.fn(async () => {});
vi.mock('./pulse.svelte', () => ({
  pulse: { pendingCount: 0, refreshCount: refreshPulse },
}));
vi.mock('$lib/state/gateway/update-state.svelte', () => ({
  updateState: { pending: false },
}));
const toastInfo = vi.fn();
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastInfo }));

const { subscribeNotificationsPolling, notifications } = await import('./notifications.svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refreshPulse.mockClear();
  toastInfo.mockClear();
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

  it('toasts the newest unread row only when a later poll sees the count grow', async () => {
    vi.useFakeTimers();
    const counts = { pending: 0, inbox: 1 };
    const newest = {
      id: 'n-2',
      kind: 'appointment.overdue',
      title: 'Cita vencida: Ana',
      href: '/pos/appointments?booking=b1',
      readAt: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.startsWith('/api/inbox?')
            ? { items: [newest] }
            : { count: url.includes('/api/inbox/count') ? counts.inbox : counts.pending },
      })),
    );

    const unsubscribe = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);
    // First count is the backlog on page load — never announced.
    expect(toastInfo).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    // Same count — nothing new.
    expect(toastInfo).not.toHaveBeenCalled();

    counts.inbox = 2;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).toBe('Cita vencida: Ana');

    counts.inbox = 1;
    await vi.advanceTimersByTimeAsync(60_000);
    // A shrinking count (someone read one) is not an arrival.
    expect(toastInfo).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
