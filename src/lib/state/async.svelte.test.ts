// @vitest-environment happy-dom
/**
 * Unit tests for async state helpers.
 *
 * The rune-backed resource is constructed by a mounted Svelte component.
 * Assertions remain in the Vitest test body, outside lifecycle callbacks, so
 * a callback that never executes cannot produce a false-green test.
 */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AsyncResource,
  createConnectedFetch,
  messageError,
} from './async.svelte';
import AsyncResourceHarness from './__fixtures__/AsyncResourceHarness.svelte';

type HarnessResource = AsyncResource<string, string[]>;

afterEach(() => cleanup());

async function mountResource(
  fetcher: (...args: string[]) => Promise<string>,
  options: { initialLoading?: boolean; formatError?: (error: unknown) => string } = {},
): Promise<HarnessResource> {
  let resource: HarnessResource | undefined;
  let ownedEffects = 0;
  render(AsyncResourceHarness, {
    props: {
      fetcher,
      ...options,
      onReady: (value) => {
        resource = value;
      },
      onOwnedEffect: () => {
        ownedEffects += 1;
      },
    },
  });
  await tick();
  expect(ownedEffects, 'mounted Svelte owner effect did not execute').toBe(1);
  expect(resource, 'mounted Svelte owner did not expose the resource').toBeDefined();
  return resource!;
}

describe('createConnectedFetch', () => {
  it('fetches once when connected, not again while still connected', () => {
    let connected = false;
    const fetchOnce = vi.fn();
    const connectedFetch = createConnectedFetch(() => connected, fetchOnce);

    connectedFetch.sync();
    expect(fetchOnce).not.toHaveBeenCalled();

    connected = true;
    connectedFetch.sync();
    connectedFetch.sync();
    connectedFetch.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('re-arms on disconnect and fetches again on reconnect', () => {
    let connected = true;
    const fetchOnce = vi.fn();
    const connectedFetch = createConnectedFetch(() => connected, fetchOnce);

    connectedFetch.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);

    connected = false;
    connectedFetch.sync();
    connected = true;
    connectedFetch.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('reset() re-arms the guard manually', () => {
    const fetchOnce = vi.fn();
    const connectedFetch = createConnectedFetch(() => true, fetchOnce);

    connectedFetch.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    connectedFetch.reset();
    connectedFetch.sync();
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });
});

describe('createAsyncResource', () => {
  it('runs the mounted owner canary before exposing reactive state', async () => {
    const resource = await mountResource(async () => 'x');
    expect(resource.data).toBeNull();
  });

  it('starts empty with default initialLoading=false', async () => {
    const resource = await mountResource(async () => 'x');
    expect(resource.data).toBeNull();
    expect(resource.loading).toBe(false);
    expect(resource.error).toBeNull();
  });

  it('honours initialLoading=true', async () => {
    const resource = await mountResource(async () => 'x', { initialLoading: true });
    expect(resource.loading).toBe(true);
  });

  it('transitions loading true to false and stores data on success', async () => {
    let resolve!: (value: string) => void;
    const resource = await mountResource(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );

    const pending = resource.load();
    await tick();
    expect(resource.loading).toBe(true);
    resolve('hello');
    await pending;
    await tick();
    expect(resource.loading).toBe(false);
    expect(resource.data).toBe('hello');
    expect(resource.error).toBeNull();
  });

  it('stores error via String(error) by default and clears loading', async () => {
    const resource = await mountResource(async () => {
      throw new Error('boom');
    });
    await resource.load();
    await tick();
    expect(resource.loading).toBe(false);
    expect(resource.error).toBe('Error: boom');
    expect(resource.data).toBeNull();
  });

  it('supports the messageError formatter', async () => {
    const resource = await mountResource(
      async () => {
        throw new Error('boom');
      },
      { formatError: messageError },
    );
    await resource.load();
    await tick();
    expect(resource.error).toBe('boom');
  });

  it('clears a prior error on the next load and forwards args', async () => {
    const fetcher = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockImplementation(async (id) => 'data:' + id);
    const resource = await mountResource(fetcher);

    await resource.load('a');
    expect(resource.error).toBe('Error: first');
    await resource.load('b');
    await tick();
    expect(fetcher).toHaveBeenNthCalledWith(1, 'a');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'b');
    expect(resource.data).toBe('data:b');
    expect(resource.error).toBeNull();
  });

  it('reset() returns to the initial empty state', async () => {
    const resource = await mountResource(async () => 'value', { initialLoading: true });
    await resource.load();
    await tick();
    expect(resource.data).toBe('value');

    resource.reset();
    await tick();
    expect(resource.data).toBeNull();
    expect(resource.error).toBeNull();
    expect(resource.loading).toBe(true);
  });
});
