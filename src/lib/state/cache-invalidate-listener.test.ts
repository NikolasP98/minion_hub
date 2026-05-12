// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  registerStore,
  unregisterStore,
  dispatchCacheInvalidate,
  __reset,
} from './cache-invalidate-listener.svelte';

beforeEach(() => __reset());

describe('cache-invalidate-listener', () => {
  it('routes events to stores with matching tags', () => {
    const invalidate = vi.fn();
    registerStore({ key: 'k', tags: ['t:1:agent-groups'], invalidate });
    dispatchCacheInvalidate({
      tags: ['t:1:agent-groups'], source: 'hub', sourceId: 'x', tenantId: 't:1', ts: 0,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch to stores without matching tags', () => {
    const invalidate = vi.fn();
    registerStore({ key: 'k', tags: ['d:sessions'], invalidate });
    dispatchCacheInvalidate({
      tags: ['d:agent-groups'], source: 'hub', sourceId: 'x', tenantId: '', ts: 0,
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('matches any-of (union) across event tags', () => {
    const invalidate = vi.fn();
    registerStore({ key: 'k', tags: ['t:1', 'd:agent-groups'], invalidate });
    dispatchCacheInvalidate({
      tags: ['anything-else', 't:1'], source: 'hub', sourceId: 'x', tenantId: 't:1', ts: 0,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('unregister removes the store from routing', () => {
    const invalidate = vi.fn();
    const handle = registerStore({ key: 'k', tags: ['t'], invalidate });
    unregisterStore(handle);
    dispatchCacheInvalidate({ tags: ['t'], source: 'hub', sourceId: 'x', tenantId: '', ts: 0 });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('matches keys-only events via key match', () => {
    const invalidate = vi.fn();
    registerStore({ key: 'hub:v1:agent-groups:t=1:u=1', tags: [], invalidate });
    dispatchCacheInvalidate({
      tags: [], keys: ['hub:v1:agent-groups:t=1:u=1'],
      source: 'hub', sourceId: 'x', tenantId: '', ts: 0,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
