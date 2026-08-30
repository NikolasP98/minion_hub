// @vitest-environment happy-dom

// Behaviour proof for the shipped containment module wired at
// `src/lib/services/gateway.svelte.ts`'s `onEvent`. It covers both loss modes of
// the installed `@minion-stack/shared` dispatch (synchronous throw escapes,
// async rejection is swallowed) and the end-to-end path into the bug-report
// sink, using the real `console-interceptor` module rather than a stand-in.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayClient } from '@minion-stack/shared/gateway';
import { dispatchGatewayEvent, EVENT_HANDLER_FAILURE_PREFIX } from './event-dispatch';
import { getConsoleBuffer, installInterceptor } from '$lib/utils/console-interceptor';

// Silence (and count) the underlying console.error BEFORE the interceptor wraps
// it, so the interceptor still records every report into its buffer while the
// test output stays clean.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
installInterceptor();

const frame = { type: 'event', event: 'agent', seq: 42, payload: { id: 'a1' } };

beforeEach(() => {
  consoleError.mockClear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('dispatchGatewayEvent', () => {
  it('passes the frame through and stays silent when the handler succeeds', () => {
    const handle = vi.fn();

    dispatchGatewayEvent(frame, handle);

    expect(handle).toHaveBeenCalledExactlyOnceWith(frame);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('contains a synchronous throw instead of letting it escape the dispatch', () => {
    const boom = new Error('handler exploded');

    expect(() =>
      dispatchGatewayEvent(frame, () => {
        throw boom;
      }),
    ).not.toThrow();

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=agent, seq=42)`,
      boom,
    );
  });

  it('reports an asynchronous rejection the installed client would swallow', async () => {
    const boom = new Error('late failure');

    dispatchGatewayEvent(frame, () => Promise.reject(boom));
    // Nothing to report until the returned promise settles.
    expect(consoleError).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=agent, seq=42)`,
      boom,
    );
  });

  it('stays silent for a handler that returns a resolving promise', async () => {
    let settled = false;

    dispatchGatewayEvent(frame, async () => {
      settled = true;
    });

    await vi.waitFor(() => expect(settled).toBe(true));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not treat an ordinary return value as a thenable', () => {
    expect(() => dispatchGatewayEvent(frame, () => ({ handled: true }))).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('assimilates and reports a rejecting callable thenable', async () => {
    const boom = new Error('callable thenable rejected');
    const callableThenable = Object.assign(() => {}, {
      then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        reject(boom);
      },
    });

    dispatchGatewayEvent(frame, () => callableThenable);

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=agent, seq=42)`,
      boom,
    );
  });

  it('assimilates a stateful thenable with one authoritative then lookup', async () => {
    const boom = new Error('stateful rejection');
    let reads = 0;
    const statefulThenable = Object.defineProperty({}, 'then', {
      get() {
        reads += 1;
        if (reads > 1) return undefined;
        return (_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          reject(boom);
        };
      },
    });

    dispatchGatewayEvent(frame, () => statefulThenable);

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(reads).toBe(1);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=agent, seq=42)`,
      boom,
    );
  });

  it('labels a frame that carries no usable event name or seq', () => {
    const boom = new Error('nameless');

    dispatchGatewayEvent({}, () => {
      throw boom;
    });

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=unknown)`,
      boom,
    );
  });

  it('lands exactly one report in the buffer the bug reporter attaches', () => {
    const before = getConsoleBuffer().length;

    dispatchGatewayEvent(frame, () => {
      throw new Error('handler exploded');
    });

    const captured = getConsoleBuffer().slice(before);
    expect(captured).toHaveLength(1);
    expect(captured[0].level).toBe('error');
    expect(captured[0].message).toContain(EVENT_HANDLER_FAILURE_PREFIX);
    expect(captured[0].message).toContain('event=agent, seq=42');
    expect(captured[0].message).toContain('handler exploded');
  });
});

class TestWebSocket {
  static instance: TestWebSocket;

  readyState = 0;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor() {
    TestWebSocket.instance = this;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(): void {}

  close(code = 1000, reason = 'test close'): void {
    this.emit('close', code, reason);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe('installed GatewayClient integration', () => {
  it('produces one hub report without closing the client', async () => {
    const onClose = vi.fn();
    const client = new GatewayClient({
      url: 'ws://gateway.test',
      WebSocketImpl: TestWebSocket,
      onChallenge: async () => ({}),
      onEvent: (gatewayFrame) =>
        dispatchGatewayEvent(gatewayFrame, () => {
          throw new Error('real client handler failure');
        }),
      onClose,
    });
    const connecting = client.connect();

    TestWebSocket.instance.emit('message', JSON.stringify(frame));

    expect(consoleError).toHaveBeenCalledOnce();
    expect(getConsoleBuffer().at(-1)?.message).toContain(EVENT_HANDLER_FAILURE_PREFIX);
    expect(onClose).not.toHaveBeenCalled();

    client.close();
    await expect(connecting).rejects.toThrow('closed before hello');
    expect(onClose).toHaveBeenCalledExactlyOnceWith(1000, 'client close');
  });

  it('reports the exact socket error once through the package default', async () => {
    const client = new GatewayClient({
      url: 'ws://gateway.test',
      WebSocketImpl: TestWebSocket,
      onChallenge: async () => ({}),
    });
    const connecting = client.connect();
    const transportError = new Error('transport failed');

    TestWebSocket.instance.emit('error', transportError);

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      '[GatewayClient] socket error:',
      transportError,
    );

    client.close();
    await expect(connecting).rejects.toThrow('closed before hello');
  });

  it('reports an automatic reconnect construction failure once through the package default', async () => {
    vi.useFakeTimers();
    let constructions = 0;
    const reconnectError = new Error('socket construction failed');
    class ReconnectWebSocket extends TestWebSocket {
      constructor() {
        super();
        constructions += 1;
        if (constructions === 2) throw reconnectError;
      }
    }
    const client = new GatewayClient({
      url: 'ws://gateway.test',
      WebSocketImpl: ReconnectWebSocket,
      onChallenge: async () => ({}),
      autoReconnect: true,
    });

    try {
      const connecting = client.connect();
      ReconnectWebSocket.instance.emit('close', 1006, 'connection lost');
      await expect(connecting).rejects.toThrow('closed before hello');

      await vi.advanceTimersByTimeAsync(800);

      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        '[GatewayClient] reconnect attempt failed:',
        reconnectError,
      );
      expect(constructions).toBe(2);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });
});

// A handler can throw or reject with ANY value, including one engineered to
// defeat the reporting path: `toJSON` makes `JSON.stringify` throw and
// `Symbol.toPrimitive` makes `String()` throw, so the interceptor's serialiser
// has no ordinary way to render it. Containment has to survive its own report —
// otherwise the failure escapes through the sink instead of the handler.
function hostileValue(): unknown {
  return {
    toJSON() {
      throw new Error('toJSON refused');
    },
    toString() {
      throw new Error('toString refused');
    },
    valueOf() {
      throw new Error('valueOf refused');
    },
    [Symbol.toPrimitive]() {
      throw new Error('toPrimitive refused');
    },
  };
}

describe('dispatchGatewayEvent reporting is total', () => {
  it('contains a synchronous throw of a value that defeats serialisation', () => {
    const before = getConsoleBuffer().length;

    expect(() =>
      dispatchGatewayEvent(frame, () => {
        throw hostileValue();
      }),
    ).not.toThrow();

    // Still reported once, with the value rendered by the sink's last resort.
    expect(consoleError).toHaveBeenCalledOnce();
    const captured = getConsoleBuffer().slice(before);
    expect(captured).toHaveLength(1);
    expect(captured[0].message).toContain(EVENT_HANDLER_FAILURE_PREFIX);
    expect(captured[0].message).toContain('[unserializable]');
  });

  it('reports a hostile asynchronous rejection without leaving it unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      dispatchGatewayEvent(frame, () => Promise.reject(hostileValue()));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(consoleError).toHaveBeenCalledOnce();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('contains a throwing `then` accessor on the handler’s return value', async () => {
    const boom = new Error('then refused');

    expect(() =>
      dispatchGatewayEvent(frame, () => ({
        get then() {
          throw boom;
        },
      })),
    ).not.toThrow();

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      `${EVENT_HANDLER_FAILURE_PREFIX} (event=agent, seq=42)`,
      boom,
    );
  });

  it('contains a reporting sink that throws, and still tries a bare report', () => {
    const patched = console.error;
    const attempts: unknown[][] = [];
    let throwOnce = true;

    console.error = (...args: unknown[]) => {
      attempts.push(args);
      if (throwOnce) {
        throwOnce = false;
        throw new Error('sink refused');
      }
    };

    try {
      expect(() =>
        dispatchGatewayEvent(frame, () => {
          throw new Error('handler exploded');
        }),
      ).not.toThrow();
    } finally {
      console.error = patched;
    }

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual([EVENT_HANDLER_FAILURE_PREFIX]);
  });

  it('gives up silently when even the bare report throws', () => {
    const patched = console.error;
    console.error = () => {
      throw new Error('sink refused');
    };

    try {
      expect(() =>
        dispatchGatewayEvent(frame, () => {
          throw hostileValue();
        }),
      ).not.toThrow();
    } finally {
      console.error = patched;
    }
  });
});
