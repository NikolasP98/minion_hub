import { describe, it, expect, vi } from 'vitest';
import { DropRegistry, type DropDestination, isFileDrag } from './drop-context.svelte';
describe('global file destination ownership', () => {
  const destination = (id: string): DropDestination => ({
    id,
    label: id,
    available: () => true,
    receive: vi.fn(async () => {}),
  });
  it('delivers only after choosing a live destination and preserves replacement registrations', async () => {
    const registry = new DropRegistry();
    const first = destination('record');
    const unregister = registry.register(first);
    expect(first.receive).not.toHaveBeenCalled();
    const next = destination('record');
    registry.register(next);
    unregister();
    await expect(registry.deliver(first, [], new AbortController().signal)).rejects.toThrow(
      'no longer',
    );
    await registry.deliver(next, [], new AbortController().signal);
    expect(next.receive).toHaveBeenCalledOnce();
  });
  it('rejects a disposed, denied or aborted destination', async () => {
    const registry = new DropRegistry();
    const target = destination('record');
    const dispose = registry.register(target);
    dispose();
    await expect(registry.deliver(target, [], new AbortController().signal)).rejects.toThrow();
    registry.register(target);
    target.available = () => false;
    expect(registry.available).toEqual([]);
    await expect(registry.deliver(target, [], new AbortController().signal)).rejects.toThrow();
    target.available = () => true;
    const abort = new AbortController();
    abort.abort();
    await expect(registry.deliver(target, [], abort.signal)).rejects.toThrow();
    expect(target.receive).not.toHaveBeenCalled();
  });
  it('ignores internal drags and ordinary text', () => {
    expect(isFileDrag({ types: ['text/plain'] })).toBe(false);
    expect(isFileDrag({ types: ['Files'] })).toBe(true);
  });
});
