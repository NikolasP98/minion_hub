// @vitest-environment happy-dom

// This module is the sink hub's gateway error-reporting posture rests on (see
// docs/2026-08-19-gateway-onevent-error-hook-adoption.md): hub's own event
// containment and, later, the shared GatewayClient's `console.error` fallback
// both report here, because the interceptor captures every `console.error` into
// the buffer the bug reporter attaches. These tests pin that mechanism — capture,
// error stacks, the ring-buffer cap, and idempotent install.
//
// Scope limit: they prove the SINK in isolation. The source→sink path for hub's
// own containment is proved end-to-end in
// `src/lib/services/gateway/event-dispatch.test.ts`; the message below is only a
// shape stand-in. How a real hook-bearing `@minion-stack/shared` client behaves
// remains unproved — no such build is published — and must be checked against the
// client itself when the dependency bump lands.

import { afterAll, describe, expect, it } from 'vitest';
import { getConsoleBuffer, installInterceptor } from './console-interceptor';

const original = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
};

installInterceptor();

afterAll(() => {
  Object.assign(console, original);
});

describe('console-interceptor', () => {
  it('captures an error report, message text and stack intact', () => {
    const before = getConsoleBuffer().length;

    console.error('[gateway] onEvent handler failed', new Error('handler exploded'));

    const captured = getConsoleBuffer().slice(before);
    expect(captured).toHaveLength(1);
    expect(captured[0].level).toBe('error');
    expect(captured[0].message).toContain('[gateway] onEvent handler failed');
    expect(captured[0].message).toContain('handler exploded');
    // Errors carry a trimmed stack so a report says where it came from.
    expect(captured[0].stack).toBeTruthy();
  });

  it('serialises circular payloads instead of throwing inside the patched console', () => {
    const before = getConsoleBuffer().length;
    const frame: Record<string, unknown> = { event: 'agent.status' };
    frame.self = frame;

    expect(() => console.warn('frame', frame)).not.toThrow();

    const captured = getConsoleBuffer().slice(before);
    expect(captured).toHaveLength(1);
    expect(captured[0].level).toBe('warn');
    expect(captured[0].message).toContain('[Circular]');
  });

  it('keeps only the newest 100 entries so a noisy session cannot grow unbounded', () => {
    // 200 pushes ≥ 2× the cap, so the surviving window is the last 100 regardless
    // of what the earlier tests left in the buffer.
    for (let i = 0; i < 200; i++) console.log(`entry-${i}`);

    const buffer = getConsoleBuffer();
    expect(buffer.map((entry) => entry.message)).toEqual(
      Array.from({ length: 100 }, (_, i) => `entry-${i + 100}`),
    );
  });

  it('is idempotent — a second install does not double-record', () => {
    installInterceptor();

    console.info('single-install-marker');

    // A second patch layer would record the same call twice.
    const buffer = getConsoleBuffer();
    expect(buffer.filter((entry) => entry.message === 'single-install-marker')).toHaveLength(1);
    expect(buffer[buffer.length - 1].level).toBe('info');
  });
});

// Reporting sinks receive whatever a failing caller hands them, including values
// engineered to defeat serialisation. `dispatchGatewayEvent` promises a handler
// failure is never rethrown, and it keeps that promise through this sink, so the
// sink itself must not throw for any input.
describe('console-interceptor hostile payloads', () => {
  const hostile = {
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

  // The ring buffer is already at its cap here (the test above fills it), so a
  // new entry evicts an old one and the length never grows: read the newest
  // entry rather than a slice from a remembered length.
  const newestEntry = () => {
    const buffer = getConsoleBuffer();
    return buffer[buffer.length - 1];
  };

  it('renders a value that defeats both JSON and String() instead of throwing', () => {
    expect(() => console.error('[gateway] onEvent handler failed', hostile)).not.toThrow();

    const entry = newestEntry();
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('[gateway] onEvent handler failed [unserializable]');
  });

  it('survives a null-prototype object, which cannot be coerced to a string', () => {
    // No prototype ⇒ no `toString`/`valueOf` ⇒ `String()` raises TypeError; the
    // throwing getter makes `JSON.stringify` bail first.
    const bare = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(bare, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter refused');
      },
    });

    expect(() => console.error('frame', bare)).not.toThrow();

    expect(newestEntry().message).toBe('frame [unserializable]');
  });
});
