import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  env: { PUBLIC_POSTHOG_KEY: 'synthetic-test-key' as string | undefined },
  building: false,
  capture: vi.fn(),
  flushValue: undefined as Promise<void> | undefined,
  flushCalls: 0,
  on: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('$app/environment', () => ({
  get building() {
    return sdk.building;
  },
}));
vi.mock('$env/dynamic/public', () => ({ env: sdk.env }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      sdk.construct(...args);
    }
    capture = sdk.capture;
    flush() {
      sdk.flushCalls++;
      return sdk.flushValue;
    }
    on = sdk.on;
  },
}));
const settle = async () => {
  await vi.dynamicImportSettled();
  await new Promise<void>((resolve) => setImmediate(resolve));
};
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  sdk.flushValue = undefined;
  sdk.flushCalls = 0;
  sdk.building = false;
  sdk.env.PUBLIC_POSTHOG_KEY = 'synthetic-test-key';
  await import('posthog-node');
});

describe('actual server capture boundary', () => {
  it('keeps fixed timing metrics but drops unknown events and fields', async () => {
    const { captureServerEvent } = await import('./posthog');
    captureServerEvent({
      event: 'server_timing',
      distinctId: 'org:org_1',
      properties: {
        duration_ms: 42,
        method: 'GET',
        status: 200,
        path: '/customer/private-sentinel',
        ssh_host: 'private-host',
      },
    });
    captureServerEvent({ event: 'private-sentinel', distinctId: 'server' });
    await settle();
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture.mock.calls[0][0]).toEqual({
      event: 'server_timing',
      distinctId: 'org:org_1',
      properties: { duration_ms: 42, method: 'GET', status: 200 },
    });
  });

  it('does not invoke hostile property accessors or throw on hostile proxies', async () => {
    const { captureServerEvent } = await import('./posthog');
    const getter = vi.fn(() => {
      throw new Error('private-getter-sentinel');
    });
    const properties = Object.defineProperty({ status: 500 }, 'duration_ms', {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      captureServerEvent({ event: 'server_timing', distinctId: 'server', properties }),
    ).not.toThrow();
    expect(() =>
      captureServerEvent({
        event: 'server_timing',
        distinctId: 'server',
        properties: new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error('private-proxy-sentinel');
            },
            ownKeys() {
              throw new Error('private-proxy-sentinel');
            },
          },
        ),
      }),
    ).not.toThrow();
    await settle();
    expect(getter).not.toHaveBeenCalled();
  });

  it('coalesces concurrent lazy initialization and preserves batching/retry settings', async () => {
    const { captureServerEvent } = await import('./posthog');
    for (let i = 0; i < 4; i++)
      captureServerEvent({
        event: 'server_timing',
        distinctId: 'server',
        properties: { duration_ms: i },
      });
    await settle();
    await vi.waitFor(() =>
      expect({
        constructors: sdk.construct.mock.calls.length,
        captures: sdk.capture.mock.calls.length,
      }).toEqual({ constructors: 1, captures: 4 }),
    );
    expect(sdk.construct.mock.calls[0][1]).toMatchObject({
      flushAt: 20,
      flushInterval: 10_000,
      requestTimeout: 3000,
      fetchRetryCount: 0,
      fetchRetryDelay: 0,
    });
  });

  it('observes an actual asynchronous flush rejection', async () => {
    const { captureServerEvent } = await import('./posthog');
    let reject!: (reason: Error) => void;
    class FlushPromise extends Promise<void> {}
    const flushing = new FlushPromise((_, fail) => {
      reject = fail;
    });
    // Test cleanup observes the baseline rejection; the spy below counts only production handlers.
    void flushing.catch(() => {});
    const then = vi.spyOn(flushing, 'then');
    sdk.flushValue = flushing;
    captureServerEvent({
      event: 'server_error',
      distinctId: 'server',
      properties: { status: 500 },
      flush: true,
    });
    await vi.waitFor(() => expect(sdk.flushCalls).toBe(1));
    reject(new Error('private-flush-sentinel'));
    await settle();
    expect(then.mock.calls.some((args) => typeof args[1] === 'function')).toBe(true);
  });

  it('contains synchronous capture and initialization failures', async () => {
    const { captureServerEvent } = await import('./posthog');
    sdk.construct.mockImplementationOnce(() => {
      throw new Error('private-init-sentinel');
    });
    expect(() => captureServerEvent({ event: 'server_error', distinctId: 'server' })).not.toThrow();
    await settle();
    sdk.capture.mockImplementationOnce(() => {
      throw new Error('private-capture-sentinel');
    });
    expect(() => captureServerEvent({ event: 'server_error', distinctId: 'server' })).not.toThrow();
    await settle();
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });
});

it('does not initialize telemetry during builds or with a missing key', async () => {
  const { captureServerEvent } = await import('./posthog');
  sdk.building = true;
  captureServerEvent({ event: 'server_timing', distinctId: 'server' });
  await settle();
  expect(sdk.construct).not.toHaveBeenCalled();
  sdk.building = false;
  sdk.env.PUBLIC_POSTHOG_KEY = undefined;
  captureServerEvent({ event: 'server_timing', distinctId: 'server' });
  await settle();
  expect(sdk.construct).not.toHaveBeenCalled();
});

it('denies top-level accessors, unknown events and invalid attribution without touching the SDK', async () => {
  const { captureServerEvent } = await import('./posthog');
  const getter = vi.fn(() => {
    throw new Error('private-top-level');
  });
  const params = Object.defineProperty({ distinctId: 'server' }, 'event', { get: getter });
  expect(() =>
    captureServerEvent(params as Parameters<typeof captureServerEvent>[0]),
  ).not.toThrow();
  captureServerEvent({ event: 'unregistered-event', distinctId: 'server' });
  captureServerEvent({ event: 'server_timing', distinctId: 'private-person@example.test' });
  await settle();
  expect(getter).not.toHaveBeenCalled();
  expect(sdk.construct).not.toHaveBeenCalled();
});
