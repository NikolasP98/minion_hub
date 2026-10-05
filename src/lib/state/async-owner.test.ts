import { describe, expect, it, vi } from 'vitest';
import { createAsyncResource, type AsyncResourceOwner } from './async.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function owner(current: () => boolean = () => true): AsyncResourceOwner {
  return Object.freeze({ token: Symbol('owner'), current });
}

describe('createAsyncResource ownership', () => {
  it('publishes only the newest generation and cannot let an old finalizer clear loading', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi
      .fn<(captured: AsyncResourceOwner, key: string) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const currentOwner = owner();
    const resource = createAsyncResource(fetcher, {
      owner: (captured: AsyncResourceOwner, _key: string) => captured,
      key: (_captured: AsyncResourceOwner, key: string) => key,
    });

    const oldRead = resource.load(currentOwner, 'old');
    const newRead = resource.load(currentOwner, 'new');
    first.resolve('stale');
    await oldRead;
    expect(resource.data).toBeNull();
    expect(resource.loading).toBe(true);
    second.resolve('current');
    await newRead;
    expect(resource.data).toBe('current');
    expect(resource.status).toBe('ready');
  });

  it('retains same-query data on failure and clears it synchronously for a new query', async () => {
    const currentOwner = owner();
    const fetcher = vi
      .fn<(captured: AsyncResourceOwner, key: string) => Promise<string>>()
      .mockResolvedValueOnce('saved')
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockRejectedValueOnce(new Error('new query failed'));
    const resource = createAsyncResource(fetcher, {
      owner: (captured: AsyncResourceOwner, _key: string) => captured,
      key: (_captured: AsyncResourceOwner, key: string) => key,
      formatError: () => 'safe failure',
    });

    await resource.load(currentOwner, 'same');
    await resource.load(currentOwner, 'same');
    expect(resource.data).toBe('saved');
    expect(resource.error).toBe('safe failure');
    const pending = resource.load(currentOwner, 'different');
    expect(resource.data).toBeNull();
    await pending;
    expect(resource.status).toBe('failed');
  });

  it('fences all getters immediately when canonical ownership changes', async () => {
    let isCurrent = true;
    const currentOwner = owner(() => isCurrent);
    const resource = createAsyncResource(async (_captured: AsyncResourceOwner) => 'private', {
      initialLoading: true,
      owner: (captured: AsyncResourceOwner) => captured,
    });
    await resource.load(currentOwner);
    expect(resource.data).toBe('private');
    isCurrent = false;
    expect(resource.data).toBeNull();
    expect(resource.error).toBeNull();
    expect(resource.loading).toBe(false);
    expect(resource.status).toBe('unavailable');
  });

  it('makes reset and a before-publish owner change invalidate late work', async () => {
    const pending = deferred<string>();
    let isCurrent = true;
    const currentOwner = owner(() => isCurrent);
    const beforePublish = vi.fn(() => {
      isCurrent = false;
    });
    const resource = createAsyncResource(() => pending.promise, {
      owner: () => currentOwner,
      beforePublish,
    });
    const read = resource.load();
    pending.resolve('late');
    await read;
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(resource.data).toBeNull();

    isCurrent = true;
    const later = deferred<string>();
    const resetResource = createAsyncResource(() => later.promise);
    const resetRead = resetResource.load();
    resetResource.reset();
    later.resolve('after reset');
    await resetRead;
    expect(resetResource.data).toBeNull();
    expect(resetResource.status).toBe('idle');
  });

  it('contains a throwing formatter and does not call a rejected transport', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('private detail');
    });
    const currentOwner = owner();
    const resource = createAsyncResource(fetcher, {
      owner: () => currentOwner,
      admit: () => 'unsupported',
      formatError: () => {
        throw new Error('formatter failed');
      },
      fallbackError: 'Safe fallback',
    });
    await resource.load();
    expect(fetcher).not.toHaveBeenCalled();
    expect(resource.status).toBe('unsupported');

    const failed = createAsyncResource(fetcher, {
      formatError: () => {
        throw new Error('formatter failed');
      },
      fallbackError: 'Safe fallback',
    });
    await failed.load();
    expect(failed.error).toBe('Safe fallback');
  });
});
