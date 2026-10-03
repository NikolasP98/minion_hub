import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReliabilityHttpOwner } from './view-owner';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./http-read', () => ({
  fetchReliabilityJson: mocks.fetch,
  RELIABILITY_HTTP_MAX_BYTES: 8 * 1024 * 1024,
}));

import { createArchitectureState } from './architecture.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function snapshot(checkedAt: number) {
  return {
    nodes: [
      {
        id: 'hub',
        name: 'Hub',
        kind: 'app',
        network: 'vercel',
        fn: 'app',
        x: 0,
        y: 0,
        icon: 'Globe',
        endpoints: [],
        description: 'Hub',
        status: 'ok',
        statusDetail: 'Serving',
      },
    ],
    edges: [],
    c4: {
      nodes: [],
      relations: [],
      generatedFrom: 'source',
    },
    checkedAt,
  };
}

function createOwner(id: string, current: () => boolean = () => true): ReliabilityHttpOwner {
  return Object.freeze({
    token: Symbol(id),
    actorId: `actor-${id}`,
    orgId: `org-${id}`,
    serverId: 'global-architecture',
    queryKey: 'architecture',
    current,
  });
}

afterEach(() => {
  mocks.fetch.mockReset();
  vi.useRealTimers();
});

describe('architecture read controller', () => {
  it('coalesces poll/manual bursts into one active plus one trailing read', async () => {
    vi.useFakeTimers();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const beforePublish = vi.fn();
    const stable = createOwner('stable');
    const state = createArchitectureState(() => stable, beforePublish, {
      intervalMs: 100,
      document: () => null,
    });
    state.mount();
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const queued = state.refresh();
    void state.refresh();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    first.resolve(snapshot(1));
    await queued;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    second.resolve(snapshot(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.snapshot?.checkedAt).toBe(2);
    expect(beforePublish).toHaveBeenCalledTimes(2);
    state.dispose();
  });

  it('starts a changed owner immediately and suppresses the late old response', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let active = 'a';
    const a = createOwner('a', () => active === 'a');
    const b = createOwner('b', () => active === 'b');
    const beforePublish = vi.fn();
    const state = createArchitectureState(() => (active === 'a' ? a : b), beforePublish, {
      document: () => null,
    });
    state.mount();
    await Promise.resolve();
    active = 'b';
    void state.refresh();
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect((mocks.fetch.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
    second.resolve(snapshot(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.snapshot?.checkedAt).toBe(2);
    first.resolve(snapshot(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.snapshot?.checkedAt).toBe(2);
    expect(beforePublish).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('does not poll while hidden and makes a late unmounted response inert', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    let visibilityState: DocumentVisibilityState = 'hidden';
    let onVisibility: () => void = () => undefined;
    const documentRef = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (_name: string, listener: EventListenerOrEventListenerObject) => {
        onVisibility = listener as () => void;
      },
      removeEventListener: () => {
        onVisibility = () => undefined;
      },
    } as unknown as Document;
    const stable = createOwner('stable');
    const state = createArchitectureState(() => stable, vi.fn(), {
      intervalMs: 100,
      document: () => documentRef,
    });
    state.mount();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.fetch).not.toHaveBeenCalled();
    visibilityState = 'visible';
    onVisibility();
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    state.dispose();
    pending.resolve(snapshot(3));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(state.snapshot).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
