import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSandboxHost } from './host.svelte';

/** A stand-in for an element frame: only `contentWindow` identity matters. */
function fakeFrame() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  return {
    postMessage,
    contentWindow,
    node: { contentWindow } as unknown as HTMLIFrameElement,
  };
}

function message(source: Window | null, data: unknown) {
  return { source, data } as unknown as MessageEvent<unknown>;
}

describe('createSandboxHost message validation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('routes a query from a registered frame under its own element id', () => {
    const host = createSandboxHost();
    const frame = fakeFrame();
    host.register(frame.node, 'el_1');
    expect(
      host.handleMessage(
        message(frame.contentWindow, {
          minion: 1,
          elementId: 'el_1',
          requestId: 'q1',
          type: 'query',
          payload: { dataset: 'crm.contacts' },
        }),
      ),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sandbox/query',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a foreign source', () => {
    const host = createSandboxHost();
    const frame = fakeFrame();
    const intruder = fakeFrame();
    host.register(frame.node, 'el_1');
    expect(
      host.handleMessage(
        message(intruder.contentWindow, {
          minion: 1,
          elementId: 'el_1',
          requestId: 'q1',
          type: 'query',
          payload: {},
        }),
      ),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a registered frame claiming another element id', () => {
    const host = createSandboxHost();
    const a = fakeFrame();
    const b = fakeFrame();
    host.register(a.node, 'el_1');
    host.register(b.node, 'el_2');
    expect(
      host.handleMessage(
        message(a.contentWindow, {
          minion: 1,
          elementId: 'el_2',
          requestId: 'q1',
          type: 'query',
          payload: {},
        }),
      ),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a minion frame message', () => {
    const host = createSandboxHost();
    const frame = fakeFrame();
    host.register(frame.node, 'el_1');
    expect(host.handleMessage(message(frame.contentWindow, 'hello'))).toBe(false);
    expect(host.handleMessage(message(frame.contentWindow, { minion: 2, elementId: 'el_1' }))).toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops routing for an unregistered frame', () => {
    const host = createSandboxHost();
    const frame = fakeFrame();
    const unregister = host.register(frame.node, 'el_1');
    unregister();
    expect(
      host.handleMessage(
        message(frame.contentWindow, {
          minion: 1,
          elementId: 'el_1',
          requestId: 'q1',
          type: 'query',
          payload: {},
        }),
      ),
    ).toBe(false);
  });

  it('reload bumps the element render nonce', () => {
    const host = createSandboxHost();
    expect(host.versionOf('el_1')).toBe(0);
    host.reload('el_1');
    expect(host.versionOf('el_1')).toBe(1);
  });
});
