// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { page } from '$app/state';
import ConnectionStatusIndicator from './ConnectionStatusIndicator.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  page.data = {};
});

describe('ConnectionStatusIndicator admin fleet-update poll', () => {
  it('polls every 30s and stops after 10 attempts while disconnected and not reconnecting', async () => {
    page.data = { user: { role: 'admin' } };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ active: false }) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    render(ConnectionStatusIndicator);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 9 more ticks at 30s = 10 attempts total.
    await vi.advanceTimersByTimeAsync(30_000 * 9);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    // Past the 10-attempt cap and the socket is not "connecting" (default
    // conn state here) — no further requests.
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    vi.unstubAllGlobals();
  });

  it('never polls for a non-admin user', async () => {
    page.data = { user: { role: 'user' } };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    render(ConnectionStatusIndicator);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
