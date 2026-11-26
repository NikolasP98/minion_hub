import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
  bindingKey,
  createPageValues,
  localValues,
  resolveBindings,
  SETTLE_MS,
} from './values.svelte';
import type { Publisher } from './wiring-types';

const publisher = (name: string, position: number, def?: Publisher['default']): Publisher => ({
  var: name,
  control: 'date_range',
  colType: 'timestamp',
  elementId: `e-${name}-${position}`,
  position,
  ...(def ? { default: def } : {}),
});

const last30 = { kind: 'date', range: 'last_30d' } as const;
const today = { kind: 'date', range: 'today' } as const;

describe('localValues', () => {
  it('starts from the filter default, empty without one', () => {
    const values = localValues(() => [publisher('period', 0, last30), publisher('other', 1)]);
    expect(values.get('period')).toEqual(last30);
    expect(values.get('other')).toBeNull();
    expect(values.get('nobody')).toBeNull();
  });

  it('a set value wins, and clearing (null) beats the default', () => {
    const values = localValues(() => [publisher('period', 0, last30)]);
    values.set('period', today);
    expect(values.get('period')).toEqual(today);
    values.set('period', null);
    expect(values.get('period')).toBeNull();
  });

  it('duplicates: the lowest position supplies the default', () => {
    const values = localValues(() => [
      publisher('period', 5, today),
      publisher('period', 1, last30),
    ]);
    expect(values.get('period')).toEqual(last30);
  });

  it('picks up a filter added later (publishers is a getter)', () => {
    let list: Publisher[] = [];
    const values = localValues(() => list);
    expect(values.get('period')).toBeNull();
    list = [publisher('period', 0, last30)];
    expect(values.get('period')).toEqual(last30);
  });
});

describe('resolveBindings', () => {
  it('keeps only connections that currently have a value', () => {
    const read = (name: string) => (name === 'period' ? today : null);
    const bindings = resolveBindings(
      [
        { var: 'period', col: 'submitted_at' },
        { var: 'status', col: 'status' },
      ],
      read,
    );
    expect(bindings).toEqual([{ col: 'submitted_at', value: today }]);
    expect(bindingKey(bindings)).toBe(JSON.stringify(bindings));
    expect(bindingKey([])).toBe('');
  });
});

describe('createPageValues (250 ms settle, FR-005)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('controls see a change at once; blocks see it once, 250 ms after the last one', () => {
    const cleanup = $effect.root(() => {
      const source = localValues(() => [publisher('period', 0)]);
      const set = vi.spyOn(source, 'set');
      const page = createPageValues(source);
      flushSync();

      page.set('period', today);
      expect(page.draft('period')).toEqual(today);
      expect(page.applied('period')).toBeNull();
      vi.advanceTimersByTime(SETTLE_MS - 1);
      page.set('period', last30);
      vi.advanceTimersByTime(SETTLE_MS - 1);
      expect(page.applied('period')).toBeNull();
      expect(set).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(page.applied('period')).toEqual(last30);
      // both queued changes land in the one settle; the last one wins
      expect(set).toHaveBeenCalledTimes(2);
      expect(page.draft('period')).toEqual(last30);
    });
    cleanup();
  });

  it('changes to two filters inside one window are both applied', () => {
    const cleanup = $effect.root(() => {
      const source = localValues(() => []);
      const page = createPageValues(source);
      flushSync();
      page.set('a', today);
      page.set('b', last30);
      vi.advanceTimersByTime(SETTLE_MS);
      expect(page.applied('a')).toEqual(today);
      expect(page.applied('b')).toEqual(last30);
    });
    cleanup();
  });
});
