// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadFailureMonitor } from './read-monitor';

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { posthog?: unknown }).posthog;
});

describe('reliability read failure monitoring', () => {
  it('emits fixed sanitized properties once per episode and monotonic minute', () => {
    let now = 10;
    vi.spyOn(window.performance, 'now').mockImplementation(() => now);
    const capture = vi.fn();
    (window as Window & { posthog?: { capture: typeof capture } }).posthog = { capture };
    const monitor = createReadFailureMonitor('pluginHealth');
    const owner = Symbol('private-owner');

    monitor.failed(owner, 'transport');
    monitor.failed(owner, 'decode');
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('reliability_read_failed', {
      resource: 'pluginHealth',
      phase: 'transport',
      schema_version: 1,
    });
    expect(Object.keys(capture.mock.calls[0]?.[1] ?? {}).sort()).toEqual([
      'phase',
      'resource',
      'schema_version',
    ]);

    monitor.ready();
    now += 59_999;
    monitor.failed(owner, 'decode');
    expect(capture).toHaveBeenCalledOnce();
    monitor.ready();
    now += 1;
    monitor.failed(owner, 'decode');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('contains monitoring failures and starts a new episode after readiness', () => {
    let now = 70_000;
    vi.spyOn(window.performance, 'now').mockImplementation(() => now);
    const capture = vi.fn(() => {
      throw new Error('monitoring unavailable');
    });
    (window as Window & { posthog?: { capture: typeof capture } }).posthog = { capture };
    const monitor = createReadFailureMonitor('architecture');

    expect(() => monitor.failed(Symbol('first'), 'transport')).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
    monitor.ready();
    now += 60_000;
    expect(() => monitor.failed(Symbol('second'), 'decode')).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
