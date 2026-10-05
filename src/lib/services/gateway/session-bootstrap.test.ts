import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSessionBootstrap, type SessionBootstrap } from './session-bootstrap';
import { AuthenticatedSession } from './authenticated-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture() {
  const options: SessionBootstrap = {
    current: () => true,
    request: vi.fn(async () => ({})),
    fetcher: vi.fn(async () => new Response('{"flows":[]}')),
    agents: vi.fn(),
    sessions: vi.fn(),
    health: vi.fn(),
    presence: vi.fn(),
    channels: vi.fn(),
    cron: vi.fn(),
    agentsError: vi.fn(),
  };
  return options;
}
afterEach(() => {
  vi.useRealTimers();
});

describe('authenticated socket ownership', () => {
  it('publishes each reconnect once and retires earlier response ownership', () => {
    const publish = vi.fn();
    const session = new AuthenticatedSession(() => true, publish);
    session.authenticated('first');
    const first = session.capture();
    session.activate();
    expect(publish).toHaveBeenCalledTimes(1);
    session.closed();
    expect(first()).toBe(false);
    session.authenticated('second');
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0]).toBe('second');
    expect(first()).toBe(false);
    expect(session.capture()()).toBe(true);
  });

  it('promotes the latest live backup hello and rejects a closed resolved backup', () => {
    let active = false;
    const publish = vi.fn();
    const session = new AuthenticatedSession(() => active, publish);
    session.authenticated('first');
    session.closed();
    active = true;
    expect(session.activate()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    active = false;
    session.authenticated('latest');
    active = true;
    expect(session.activate()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe('latest');
    active = false;
    expect((publish.mock.calls[0][1] as () => boolean)()).toBe(false);
  });
});

describe('session bootstrap and poll lifetime', () => {
  it('performs actual initial reads, then retires every pending publication and the delayed timer', async () => {
    vi.useFakeTimers();
    const options = fixture();
    const pending = deferred<unknown>();
    options.request = vi.fn(() => pending.promise);
    const stop = startSessionBootstrap(options);
    expect(options.request).toHaveBeenCalledTimes(6);
    stop();
    pending.resolve({ stale: true });
    await settle();
    for (const apply of [
      options.agents,
      options.sessions,
      options.health,
      options.presence,
      options.channels,
      options.cron,
    ])
      expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(options.request).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies initial and poll reads but never stacks a slow poll', async () => {
    vi.useFakeTimers();
    const options = fixture();
    const stop = startSessionBootstrap(options);
    await settle();
    expect(options.agents).toHaveBeenCalledWith({}, true);
    const pending = deferred<unknown>();
    options.request = vi.fn(() => pending.promise);
    await vi.advanceTimersByTimeAsync(93_000);
    // One three-request roster poll and one presence poll; both remain pending.
    expect(options.request).toHaveBeenCalledTimes(4);
    pending.resolve({ fresh: true });
    await settle();
    expect(options.agents).toHaveBeenLastCalledWith({ fresh: true }, false);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a retired poll release a newer session guard or overwrite its result', async () => {
    vi.useFakeTimers();
    const old = fixture();
    const oldPending = deferred<unknown>();
    old.request = vi.fn(() => oldPending.promise);
    const stopOld = startSessionBootstrap(old);
    await vi.advanceTimersByTimeAsync(33_000);
    stopOld();
    const next = fixture();
    const nextPending = deferred<unknown>();
    next.request = vi.fn(() => nextPending.promise);
    const stopNext = startSessionBootstrap(next);
    await vi.advanceTimersByTimeAsync(33_000);
    oldPending.resolve({ old: true });
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(next.request).toHaveBeenCalledTimes(10);
    expect(old.agents).not.toHaveBeenCalled();
    nextPending.resolve({ next: true });
    await settle();
    expect(next.agents).toHaveBeenLastCalledWith({ next: true }, false);
    stopNext();
  });

  it('fences delayed flow fetches and checks ownership between captured-transport registrations', async () => {
    vi.useFakeTimers();
    const options = fixture();
    let current = true;
    options.current = () => current;
    const pending = deferred<unknown>();
    options.fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            flows: ['a', 'b'].map((id) => ({
              id,
              nodes: [{ type: 'trigger', data: { event: 'tick' } }],
            })),
          }),
        ),
    );
    options.request = vi.fn((method) =>
      method === 'flows.trigger.register' ? pending.promise : Promise.resolve({}),
    );
    const stop = startSessionBootstrap(options);
    await settle();
    expect(options.request).toHaveBeenCalledWith(
      'flows.trigger.register',
      expect.objectContaining({ flowId: 'a' }),
    );
    current = false;
    pending.resolve({});
    await settle();
    expect(options.request).not.toHaveBeenCalledWith(
      'flows.trigger.register',
      expect.objectContaining({ flowId: 'b' }),
    );
    stop();
  });
});
