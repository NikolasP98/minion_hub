// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/svelte';
import SessionViewer from './SessionViewer.svelte';
import { setLanguageTag } from '$lib/paraglide/runtime';

const { history, scroll } = vi.hoisted(() => ({ history: vi.fn(), scroll: vi.fn() }));
vi.mock('$lib/services/gateway.svelte', () => ({ sendRequest: history }));
vi.mock('$lib/virtual/virtualizer.svelte', () => ({
  createVirtualizer: (options: { count: number; getItemKey: (i: number) => string }) => ({
    getTotalSize: () => options.count * 96,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: options.getItemKey(index),
        start: index * 96,
      })),
    measureElement: () => {},
    scrollToIndex: scroll,
  }),
}));
vi.mock('$lib/state/agents/tool-catalog.svelte', () => ({
  toolCatalog: { byId: {} },
  ensureToolCatalogLoaded: vi.fn(),
}));
vi.mock('$lib/state/features/aliases.svelte', () => ({
  useAliasDirectory: vi.fn(),
  getAliases: () => ({}),
}));
const marker = '[chat.history omitted: message too large]';
const notice = 'This earlier message is too large to display here.';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setLanguageTag('en');
});

describe('Session Viewer raw history loading', () => {
  it.each(['user', 'assistant'])(
    'preserves %s metadata and mixed blocks through the cache-miss path',
    async (role) => {
      setLanguageTag('en');
      const messages = [
        {
          role,
          content: marker,
          timestamp: 100,
          __openclaw: { truncated: true, reason: 'oversized' },
        },
        {
          role,
          content: marker,
          timestamp: 200,
          __openclaw: { truncated: false, reason: 'other' },
        },
        {
          role,
          content: [
            { type: 'text', text: marker },
            { type: 'text', text: 'Real explanation.' },
          ],
          timestamp: 300,
          __openclaw: { truncated: true, reason: 'oversized' },
        },
      ];
      const original = JSON.stringify(messages);
      history.mockResolvedValue({ messages });
      let cacheReads = 0;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Response.json({ ok: true });
        // Cache projection strips metadata and joins blocks. It must not replace
        // raw display context after chat.history has returned that context.
        return Response.json({
          messages:
            ++cacheReads === 1
              ? []
              : messages.map((m, i) => ({
                  ...m,
                  id: String(i),
                  content: marker,
                  __openclaw: undefined,
                })),
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const view = render(SessionViewer, {
        serverId: 'qa-server',
        sessionKey: 'qa-session',
        session: null,
      });
      await waitFor(() => {
        expect(view.container.textContent).toContain('Real explanation.');
        expect(view.container.textContent?.split(notice).length).toBe(2);
        expect(view.container.textContent?.split(marker).length).toBe(3);
      });
      expect(history).toHaveBeenCalledExactlyOnceWith('chat.history', {
        sessionKey: 'qa-session',
        limit: 1000,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ messages });
      expect(JSON.stringify(messages)).toBe(original);
    },
  );

  it.each([null, false, [], { truncated: false }])(
    'preserves invalid metadata %j even when the cache write fails',
    async (metadata) => {
      history.mockResolvedValue({
        messages: [{ role: 'user', content: marker, __openclaw: metadata }],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === 'POST') throw new Error('Cache offline');
          return Response.json({ messages: [] });
        }),
      );
      const view = render(SessionViewer, {
        serverId: 'qa-server',
        sessionKey: 'qa-session',
        session: null,
      });
      await waitFor(() => expect(view.container.textContent).toContain(marker));
      expect(view.container.textContent).not.toContain(notice);
    },
  );

  it('uses legacy cached messages without fetching or rewriting history', async () => {
    const messages = [{ id: 'cached-1', role: 'user', content: marker, timestamp: 100 }];
    const original = JSON.stringify(messages);
    const fetchMock = vi.fn(async () => Response.json({ messages }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SessionViewer, {
      serverId: 'qa-server',
      sessionKey: 'qa-session',
      session: null,
    });
    await waitFor(() => expect(view.container.textContent).toContain(notice));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
    expect(JSON.stringify(messages)).toBe(original);
  });
  it('cancels pending scroll work when the viewer unmounts', async () => {
    vi.useFakeTimers();
    history.mockResolvedValue({ messages: [{ role: 'user', content: marker }] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ messages: [] })),
    );
    const view = render(SessionViewer, {
      serverId: 'qa-server',
      sessionKey: 'qa-session',
      session: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.container.textContent).toContain(notice);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(scroll).not.toHaveBeenCalled();
    view.unmount();
    await vi.runAllTimersAsync();
    expect(scroll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not schedule scroll work for history arriving after unmount', async () => {
    vi.useFakeTimers();
    let finishHistory!: (value: { messages: { role: string; content: string }[] }) => void;
    history.mockReturnValue(
      new Promise((resolve) => {
        finishHistory = resolve;
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ messages: [] })),
    );
    const view = render(SessionViewer, {
      serverId: 'qa-server',
      sessionKey: 'qa-session',
      session: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(history).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      finishHistory({ messages: [{ role: 'user', content: marker }] });
      await vi.advanceTimersByTimeAsync(0);
    });
    await vi.runAllTimersAsync();
    expect(scroll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
