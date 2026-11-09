// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inactiveSimulation, SIMULATION_GENERATION_HEADER } from '$lib/role-simulation';
import {
  installRoleSimulationClient,
  transitionRoleSimulation,
  prepareAuthorityChange,
} from './role-simulation-client';

const generation = '40000000-0000-4000-8000-000000000001';
const nextGeneration = '40000000-0000-4000-8000-000000000002';
let dispose: (() => void) | undefined;
let state = { ...inactiveSimulation(), generation };
let owner = 'actor:organization';
const fetchMock = vi.fn<typeof fetch>();
const reload = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  owner = 'actor:organization';
  state = { ...inactiveSimulation(), generation };
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  reload.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.fetch = fetchMock;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function install(options: Partial<Parameters<typeof installRoleSimulationClient>[0]> = {}) {
  dispose = installRoleSimulationClient({
    readState: () => state,
    readOwner: () => owner,
    navigate: reload,
    ...options,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('simulation browser transport', () => {
  it('stamps existing raw same-origin fetch writes without modifying foreign requests', async () => {
    install();
    await window.fetch('/api/records', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get(SIMULATION_GENERATION_HEADER)).toBe(generation);
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    await window.fetch('https://other.example/api', { method: 'POST' });
    expect(fetchMock.mock.calls[1][1]?.headers).toBeUndefined();
  });

  it('retires a read after authority changes, including a delayed body parse', async () => {
    let parse!: (value: unknown) => void;
    const json = new Promise<unknown>((done) => (parse = done));
    const response = new Response('{}');
    vi.spyOn(response, 'json').mockReturnValue(json);
    fetchMock.mockResolvedValue(response);
    install();
    const read = await window.fetch('/api/records');
    const body = read.json();
    state = { ...state, generation: nextGeneration };
    parse({ secret: true });
    await expect(body).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports an already admitted mutation truthfully after a generation change', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    install();
    const write = window.fetch('/api/records', { method: 'POST' });
    state = { ...state, generation: nextGeneration };
    pending.resolve(new Response('{"committed":true}'));
    await expect((await write).json()).resolves.toEqual({ committed: true });
  });

  it('does not change mode when an existing editor reports unsaved changes', async () => {
    const dirty = (event: Event) => event.preventDefault();
    window.addEventListener('beforeunload', dirty);
    install();
    await expect(
      transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' }),
    ).rejects.toMatchObject({ code: 'dirty' });
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener('beforeunload', dirty);
  });

  it('waits for a pending raw write and quiet period before Apply, then broadcasts/reloads', async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation((input) =>
      String(input).includes('/role-simulation')
        ? Promise.resolve(
            new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' })),
          )
        : pending.promise,
    );
    install();
    const write = window.fetch('/api/records', { method: 'PATCH' });
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(new Response('{}'));
    await write;
    await vi.advanceTimersByTimeAsync(600);
    await transition;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      generation,
      roleKey: 'viewer',
      returnTo: '/crm',
    });
    expect(reload).toHaveBeenCalledWith('/crm');
  });

  it('keeps mode and draft on a rejected transition and permits subsequent ordinary writes', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).includes('/role-simulation')
          ? new Response('{"message":"Forbidden"}', { status: 403 })
          : new Response('{}'),
      ),
    );
    install();
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    const rejection = expect(transition).rejects.toMatchObject({ code: 'rejected' });
    await vi.advanceTimersByTimeAsync(600);
    await rejection;
    expect(reload).not.toHaveBeenCalled();
    await window.fetch('/api/records', { method: 'PATCH' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not treat an ordinary record conflict as a mode change', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"RECORD_CONFLICT"}', { status: 409 }));
    install();
    expect((await window.fetch('/api/records', { method: 'PATCH' })).status).toBe(409);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads a stale tab on an authoritative generation-conflict header', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 409,
        headers: { [SIMULATION_GENERATION_HEADER]: nextGeneration },
      }),
    );
    install();
    const response = await window.fetch('/api/records', { method: 'PATCH' });
    expect(response.status).toBe(409);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stamps native form submissions and restores only its own fetch wrapper on teardown', async () => {
    install();
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/api/records';
    document.body.append(form);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(new FormData(form).get('_roleSimulationGeneration')).toBe(generation);
    dispose?.();
    expect(window.fetch).toBe(fetchMock);
    form.remove();
  });

  it('waits for foreground work even when independent durable jobs are already running', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' })),
    );
    const actions = {
      foregroundPending: 1,
      backgroundPending: 0,
      backgroundJobs: 3,
      attentionRequired: 0,
    };
    install();
    const transition = transitionRoleSimulation({
      state,
      roleKey: 'viewer',
      returnTo: '/crm',
      actions,
    });
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).not.toHaveBeenCalled();
    actions.foregroundPending = 0;
    await vi.advanceTimersByTimeAsync(50);
    await transition;
    expect(reload).toHaveBeenCalledWith('/crm');
  });

  it('continues safely when channel construction and the storage accessor are unavailable', async () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('unavailable');
        }
      },
    );
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' })),
    );
    install();
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    await vi.advanceTimersByTimeAsync(600);
    await transition;
    expect(reload).toHaveBeenCalledWith('/crm');
  });

  it('revalidates invalid mode on focus even when its generation has not changed', async () => {
    state = { ...state, active: true, roleKey: 'viewer', orgId: 'org-a' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...state, invalid: true })));
    install();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('preserves an uncertain outcome and never blindly replays its transition', async () => {
    fetchMock.mockRejectedValue(new Error('ack lost'));
    install();
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    const rejected = expect(transition).rejects.toMatchObject({ code: 'unknown' });
    await vi.advanceTimersByTimeAsync(600);
    await rejected;
    await expect(
      transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' }),
    ).rejects.toMatchObject({ code: 'stale' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each(['lost acknowledgement', 'server error', 'malformed receipt'] as const)(
    'retires an unknown Start outcome after %s before old-owner reads can publish',
    async (failure) => {
      const late = deferred<Response>();
      const parsed = deferred<unknown>();
      const response = new Response('{}');
      vi.spyOn(response, 'json').mockReturnValue(parsed.promise);
      fetchMock.mockImplementation((input) => {
        const path = String(input);
        if (path === '/api/late') return late.promise;
        if (path === '/api/body') return Promise.resolve(response);
        if (failure === 'lost acknowledgement') return Promise.reject(new Error('ack lost'));
        return Promise.resolve(
          failure === 'server error'
            ? new Response('{}', { status: 503 })
            : new Response('{"location":"/crm"}'),
        );
      });
      const retired = vi.fn();
      const rejectedContinuation = vi.fn();
      install({ onRetire: retired, onRejected: rejectedContinuation });
      const body = (await window.fetch('/api/body')).json();
      const pendingRead = window.fetch('/api/late');
      const oldBody = expect(body).rejects.toMatchObject({ name: 'AbortError' });
      const oldRead = expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' });
      const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
      const outcome = expect(transition).rejects.toMatchObject({ code: 'unknown' });
      await vi.advanceTimersByTimeAsync(600);
      await outcome;
      // The old page projection deliberately still says owner/off. Retirement
      // must fence it even when the lost receipt never supplied a generation.
      parsed.resolve({ privateOwnerData: true });
      late.resolve(new Response('{"privateOwnerData":true}'));
      await Promise.all([oldBody, oldRead]);
      expect(state.active).toBe(false);
      expect(retired).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
      expect(rejectedContinuation).not.toHaveBeenCalled();
      const before = fetchMock.mock.calls.length;
      await expect(window.fetch('/api/records', { method: 'PATCH' })).rejects.toMatchObject({
        code: 'busy',
      });
      expect(fetchMock).toHaveBeenCalledTimes(before);
    },
  );

  it('fences a delayed Response.body reader chunk after its captured generation changes', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
      cancel: cancelled,
    });
    fetchMock.mockResolvedValue(new Response(stream));
    install();
    const response = await window.fetch('/api/stream');
    const reader = response.body!.getReader();
    const next = reader.read();
    const rejected = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    state = { ...state, generation: nextGeneration };
    source.enqueue(new TextEncoder().encode('private-owner-row'));
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('cancels pending cloned body readers when the document retires', async () => {
    const stream = new ReadableStream<Uint8Array>();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).includes('/role-simulation')
          ? new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' }))
          : new Response(stream),
      ),
    );
    install();
    const response = await window.fetch('/api/stream');
    const reader = response.clone().body!.getReader();
    const next = reader.read();
    const rejected = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    await vi.advanceTimersByTimeAsync(600);
    await transition;
    await rejected;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps the body fence when a values iterator is consumed through for-await', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
    });
    fetchMock.mockResolvedValue(new Response(stream));
    install();
    const response = await window.fetch('/api/stream');
    const body = response.body as ReadableStream<Uint8Array> & {
      values(): AsyncIterableIterator<Uint8Array>;
    };
    const iterator = body.values();
    const consume = (async () => {
      for await (const chunk of iterator) return new TextDecoder().decode(chunk);
      return '';
    })();
    const rejected = expect(consume).rejects.toMatchObject({ name: 'AbortError' });
    state = { ...state, generation: nextGeneration };
    source.enqueue(new TextEncoder().encode('private-owner-row'));
    await rejected;
  });

  it('interrupts a pending for-await body read when its document retires', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).includes('/role-simulation')
          ? new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' }))
          : new Response(new ReadableStream<Uint8Array>()),
      ),
    );
    install();
    const response = await window.fetch('/api/stream');
    const body = response.body as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>;
    const consume = (async () => {
      for await (const chunk of body) return new TextDecoder().decode(chunk);
      return '';
    })();
    const rejected = expect(consume).rejects.toMatchObject({ name: 'AbortError' });
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    await vi.advanceTimersByTimeAsync(600);
    await transition;
    await rejected;
  });

  it('keeps a retired BFCache document concealed and recovers through a fresh document GET', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ generation: nextGeneration, location: '/en/crm' })),
    );
    install();
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/en/crm' });
    await vi.advanceTimersByTimeAsync(600);
    await transition;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenLastCalledWith('/en/crm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not apply a late transition response to another organization', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    install();
    const transition = transitionRoleSimulation({ state, roleKey: 'viewer', returnTo: '/crm' });
    await vi.advanceTimersByTimeAsync(600);
    owner = 'actor:other-organization';
    pending.resolve(new Response(JSON.stringify({ generation: nextGeneration, location: '/crm' })));
    await expect(transition).rejects.toMatchObject({ code: 'stale' });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('policy authority changes', () => {
  it('drains before the write command and admits exactly one policy PUT while other writes are frozen', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    install();
    const actions = {
      foregroundPending: 0,
      backgroundPending: 0,
      backgroundJobs: 0,
      attentionRequired: 0,
    };
    const preparing = prepareAuthorityChange(actions);
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    // The command is registered only AFTER preparation. It must not wait on itself.
    actions.foregroundPending = 1;
    await expect(window.fetch('/api/records', { method: 'PATCH' })).rejects.toMatchObject({
      code: 'busy',
    });
    const response = await change.fetch('/api/nav/access', { method: 'PUT', body: '{}' });
    expect(response.ok).toBe(true);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(SIMULATION_GENERATION_HEADER)).toBe(
      generation,
    );
    await expect(
      change.fetch('/api/nav/access', { method: 'PUT', body: '{}' }),
    ).rejects.toMatchObject({ code: 'busy' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(change.commit('/en/crm')).toBe(true);
    expect(reload).toHaveBeenCalledWith('/en/crm');
  });

  it('retires a controlled write generation conflict even without broadcast or storage', async () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('unavailable');
        }
      },
    );
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    fetchMock.mockResolvedValue(
      new Response('{"code":"ROLE_SIMULATION_GENERATION_CONFLICT"}', {
        status: 409,
        headers: { [SIMULATION_GENERATION_HEADER]: nextGeneration },
      }),
    );
    const retired = vi.fn();
    install({ onRetire: retired });
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    await expect(
      change.fetch('/api/nav/access', { method: 'PUT', body: '{}' }),
    ).rejects.toMatchObject({ code: 'stale' });
    change.cancel();
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(true);
    expect(retired).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(window.fetch('/api/records', { method: 'PATCH' })).rejects.toMatchObject({
      code: 'busy',
    });
    await expect(
      change.fetch('/api/nav/access', { method: 'PUT', body: '{}' }),
    ).rejects.toMatchObject({ code: 'stale' });
    expect(change.retryNavigation()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, generation])(
    'keeps ordinary policy conflicts editable with generation header %s',
    async (header) => {
      fetchMock.mockResolvedValue(
        new Response('{"code":"POLICY_CONFLICT"}', {
          status: 409,
          headers: header ? { [SIMULATION_GENERATION_HEADER]: header } : undefined,
        }),
      );
      const retired = vi.fn();
      install({ onRetire: retired });
      const preparing = prepareAuthorityChange();
      await vi.advanceTimersByTimeAsync(600);
      const change = await preparing;
      expect((await change.fetch('/api/nav/access', { method: 'PUT', body: '{}' })).status).toBe(
        409,
      );
      change.cancel();
      expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(false);
      expect(retired).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect((await window.fetch('/api/records', { method: 'PATCH' })).status).toBe(409);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps the existing document and drafts after a definite rejected policy write', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValue(new Response('{}'));
    const retired = vi.fn();
    install({ onRetire: retired });
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    expect((await change.fetch('/api/nav/access', { method: 'PUT' })).status).toBe(403);
    change.cancel();
    expect(retired).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(false);
    await expect(window.fetch('/api/records', { method: 'PATCH' })).resolves.toHaveProperty(
      'ok',
      true,
    );
  });

  it('retires unknown policy outcomes and repeats only the safe document GET during recovery', async () => {
    fetchMock.mockRejectedValue(new Error('write acknowledgement lost'));
    const retired = vi.fn();
    install({ onRetire: retired });
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    await expect(change.fetch('/api/nav/access', { method: 'PUT' })).rejects.toThrow();
    expect(change.unknown('/en/account/home')).toBe(true);
    expect(retired).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledWith('/en/account/home');
    change.cancel();
    expect(change.retryNavigation()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(window.fetch('/api/records', { method: 'PATCH' })).rejects.toMatchObject({
      code: 'busy',
    });
  });

  it('does not apply an old controller receipt or unknown recovery to another owner', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    const retired = vi.fn();
    install({ onRetire: retired });
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    await change.fetch('/api/nav/access', { method: 'PUT' });
    owner = 'actor:other-org';
    expect(change.isCurrent()).toBe(false);
    expect(change.commit('/en/crm')).toBe(false);
    expect(change.unknown('/en/account/home')).toBe(false);
    expect(change.retryNavigation()).toBe(false);
    expect(retired).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('cannot reopen old authority by cancelling an acknowledged successful policy write', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    install();
    const preparing = prepareAuthorityChange();
    await vi.advanceTimersByTimeAsync(600);
    const change = await preparing;
    await change.fetch('/api/nav/access', { method: 'PUT' });
    change.cancel();
    expect(reload).toHaveBeenCalledOnce();
    expect(document.documentElement.hasAttribute('data-authority-retiring')).toBe(true);
    await expect(window.fetch('/api/records', { method: 'PATCH' })).rejects.toMatchObject({
      code: 'busy',
    });
  });
});
