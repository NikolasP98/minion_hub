import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshPulse = vi.fn(async () => {});
vi.mock('./pulse.svelte', () => ({
  pulse: { pendingCount: 0, refreshCount: refreshPulse },
}));
vi.mock('$lib/state/gateway/update-state.svelte', () => ({
  updateState: { pending: false },
}));

const { subscribeNotificationsPolling } = await import('./notifications.svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refreshPulse.mockClear();
});

describe('notification polling coordinator', () => {
  it('shares one initial refresh and interval across both shell subscribers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ count: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribeTopbar = subscribeNotificationsPolling();
    const unsubscribeIsland = subscribeNotificationsPolling();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshPulse).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshPulse).toHaveBeenCalledTimes(2);

    unsubscribeTopbar();
    unsubscribeIsland();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
