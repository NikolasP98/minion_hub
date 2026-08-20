// @vitest-environment happy-dom

// Behaviour proof for the shipped containment module wired at
// `src/lib/services/gateway.svelte.ts`'s `onEvent`. It covers both loss modes of
// the installed `@minion-stack/shared` dispatch (synchronous throw escapes,
// async rejection is swallowed) and the end-to-end path into the bug-report
// sink, using the real `console-interceptor` module rather than a stand-in.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('contains a throwing `then` accessor on the handler’s return value', () => {
    const boom = new Error('then refused');

    expect(() =>
      dispatchGatewayEvent(frame, () => ({
        get then() {
          throw boom;
        },
      })),
    ).not.toThrow();

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
