// @vitest-environment happy-dom

// This module is the sink hub's `onEventError` posture rests on: hub accepts the
// shared GatewayClient's `console.error` fallback (see
// docs/2026-08-19-gateway-onevent-error-hook-adoption.md) precisely because the
// interceptor captures it into the buffer the bug reporter attaches. These tests
// pin that mechanism — capture, error stacks, and the ring-buffer cap.

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
  it('captures a gateway-shaped error report with its message text intact', () => {
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
