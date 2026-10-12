import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshPulse = vi.fn(async () => {});
const setPulsePendingCount = vi.fn();
vi.mock('./pulse.svelte', () => ({
  pulse: { pendingCount: 0, refreshCount: refreshPulse, setPendingCount: setPulsePendingCount },
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
  setPulsePendingCount.mockClear();
  toastInfo.mockClear();
});

/** Routes by URL — one poll cycle now fires exactly ONE fetch, to the combined
 *  /api/shell/counts endpoint (replaces the old join-requests/count + inbox/count
 *  + pulse/count trio). */
function stubCountFetch(counts: { pending: number; inbox: number; pulse?: number }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('/api/shell/counts')
        ? { joinRequests: counts.pending, inbox: counts.inbox, pulse: counts.pulse ?? 0 }
        : {},
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

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unsubscribeTopbar();
    unsubscribeIsland();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds the inbox unread count into the bell badge total and forwards pulse to its own state', async () => {
    vi.useFakeTimers();
    stubCountFetch({ pending: 2, inbox: 5, pulse: 3 });

    const unsubscribe = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications.pendingCount).toBe(2);
    expect(notifications.inboxUnreadCount).toBe(5);
    expect(setPulsePendingCount).toHaveBeenCalledWith(3);
    // badgeCount = pendingCount + pulse.pendingCount(0, mocked) + update(0) + inboxUnreadCount
    expect(notifications.badgeCount).toBe(7);

    unsubscribe();
  });

  it('skips the poll tick while the tab is hidden, and refreshes immediately when it becomes visible', async () => {
    vi.useFakeTimers();
    // inbox:5 matches the previous test's leftover inboxUnreadCount so this
    // test doesn't shift the "grew" baseline the toast test below relies on.
    const fetchMock = stubCountFetch({ pending: 0, inbox: 5 });
    let hidden = false;
    const listeners: Array<() => void> = [];
    vi.stubGlobal('document', {
      get hidden() {
        return hidden;
      },
      addEventListener: (_event: string, cb: () => void) => listeners.push(cb),
      removeEventListener: (_event: string, cb: () => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    });

    const unsubscribe = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = true;
    await vi.advanceTimersByTimeAsync(120_000);
    // Tab hidden — the tick is skipped entirely, no request at all.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = false;
    listeners.forEach((cb) => cb());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
            : { joinRequests: counts.pending, inbox: counts.inbox, pulse: 0 },
      })),
    );

    const unsubscribe = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);
    // First count is the backlog on page load — never announced.
    expect(toastInfo).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120_000);
    // Same count — nothing new.
    expect(toastInfo).not.toHaveBeenCalled();

    counts.inbox = 2;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).toBe('Cita vencida: Ana');

    counts.inbox = 1;
    await vi.advanceTimersByTimeAsync(120_000);
    // A shrinking count (someone read one) is not an arrival.
    expect(toastInfo).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
