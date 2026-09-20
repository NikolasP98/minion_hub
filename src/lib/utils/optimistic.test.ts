import { describe, expect, it } from 'vitest';
import { createOptimistic } from './optimistic';

describe('createOptimistic', () => {
  it('shows the intended value while in flight, then the committed one', async () => {
    const o = createOptimistic<boolean>();
    let resolve!: (ok: boolean) => void;
    const run = o.run('a', true, () => new Promise<boolean>((r) => (resolve = r)));

    expect(o.get('a', false)).toBe(true);
    expect(o.isPending('a')).toBe(true);
    expect(o.get('b', false)).toBe(false);

    resolve(true);
    await expect(run).resolves.toBe(true);
    expect(o.isPending('a')).toBe(false);
    // Server value (post-invalidate) now wins: new value on success…
    expect(o.get('a', true)).toBe(true);
  });

  it('reverts to the committed value on rejection or throw', async () => {
    const o = createOptimistic<boolean>();
    await expect(o.run('a', true, async () => false)).resolves.toBe(false);
    expect(o.get('a', false)).toBe(false);

    await expect(
      o.run('a', true, async () => {
        throw new Error('boom');
      }),
    ).resolves.toBe(false);
    expect(o.isPending('a')).toBe(false);
    expect(o.get('a', false)).toBe(false);
  });
});
