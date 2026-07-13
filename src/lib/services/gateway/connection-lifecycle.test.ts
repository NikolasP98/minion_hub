import { describe, expect, it } from 'vitest';
import type { Host } from '$lib/types/host';
import { ConnectionLifecycleFence, isDistinctCutoverTarget } from './connection-lifecycle';

const host = (id: string, url: string): Host => ({ id, name: id, url, lastConnectedAt: null });

describe('ConnectionLifecycleFence', () => {
  it('rejects a stale token-fetch completion after a newer connect begins', () => {
    const fence = new ConnectionLifecycleFence();
    const first = fence.begin();
    const second = fence.begin();

    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(second)).toBe(true);
  });

  it('rejects a backup completion after disconnect invalidates the lifecycle', () => {
    const fence = new ConnectionLifecycleFence();
    const cutover = fence.snapshot();
    fence.invalidate();

    expect(fence.isCurrent(cutover)).toBe(false);
  });
});

describe('isDistinctCutoverTarget', () => {
  it('accepts a different endpoint and lets its handshake prove health', () => {
    expect(
      isDistinctCutoverTarget(host('a', 'wss://a.example'), host('b', 'wss://b.example')),
    ).toBe(true);
  });

  it('rejects the source, an empty URL, and duplicate endpoint aliases', () => {
    const source = host('a', 'wss://a.example/');
    expect(isDistinctCutoverTarget(source, source)).toBe(false);
    expect(isDistinctCutoverTarget(source, host('b', ''))).toBe(false);
    expect(isDistinctCutoverTarget(source, host('b', 'wss://a.example'))).toBe(false);
  });
});
