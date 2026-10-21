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

describe('overlapping intentions', () => {
  it('an older completion cannot clear the newest overlay', async () => {
    const overlay = createOptimistic<string>();
    let first!: (ok: boolean) => void;
    let second!: (ok: boolean) => void;
    const a = overlay.run('id', 'first', () => new Promise((r) => (first = r)));
    const b = overlay.run('id', 'second', () => new Promise((r) => (second = r)));
    first(false);
    await a;
    expect(overlay.get('id', 'committed')).toBe('second');
    expect(overlay.isPending('id')).toBe(true);
    second(true);
    await b;
    expect(overlay.isPending('id')).toBe(false);
  });
});

describe('identity boundary', () => {
  it('retires old intentions and ignores their late completions after an organization switch', async () => {
    const { page } = await import('$app/state');
    Object.assign(page.data, { user: { id: 'actor' }, activeOrgId: 'first' });
    const overlay = createOptimistic<string>();
    let finishOld!: (ok: boolean) => void;
    let finishNew!: (ok: boolean) => void;
    const old = overlay.run(
      'same-id',
      'old-private-value',
      () => new Promise((r) => (finishOld = r)),
    );
    page.data.activeOrgId = 'second';
    expect(overlay.get('same-id', 'new-owner')).toBe('new-owner');
    const next = overlay.run('same-id', 'new-intention', () => new Promise((r) => (finishNew = r)));
    finishOld(true);
    await old;
    expect(overlay.get('same-id', 'new-owner')).toBe('new-intention');
    finishNew(true);
    await next;
    page.data = {};
  });
});
