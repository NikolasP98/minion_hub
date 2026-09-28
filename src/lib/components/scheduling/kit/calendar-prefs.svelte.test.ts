/**
 * `localStorage` doesn't exist under the node test env, so it's stubbed (same
 * pattern as `src/lib/state/features/agent-notes.svelte.test.ts`).
 *
 * NOT wrapped in `$effect.root` — see the TODO(handoff) in
 * `settled-day.svelte.test.ts` for why bare `$effect`s (root or not) never
 * actually run in this harness. That specifically means
 * `createCalendarPrefs`'s "read the persisted value on init" `$effect`s are
 * UNTESTABLE here (confirmed: calling the factory after seeding storage still
 * returns the defaults) — real coverage is this slice's required browser
 * verification (colour picker + week-days stepper persist across reload).
 * The setter functions below (`setColorBy`/`setWeekDays`/`setSplit`) are
 * plain functions with no `$effect` involved, so they and the defaults ARE
 * genuinely tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCalendarPrefs } from './calendar-prefs.svelte';

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    _map: m,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('createCalendarPrefs', () => {
  it('defaults to status/staff colour, 7 week days, split off with no storage', () => {
    vi.stubGlobal('localStorage', mockStorage());
    const prefs = createCalendarPrefs('pos');
    expect(prefs.blockColorBy).toBe('status');
    expect(prefs.sliverColorBy).toBe('staff');
    expect(prefs.weekDays).toBe(7);
    expect(prefs.split).toBe(false);
  });

  it('the "pos" namespace resolves to the EXACT keys the POS page shipped with', () => {
    const storage = mockStorage();
    vi.stubGlobal('localStorage', storage);
    const prefs = createCalendarPrefs('pos');

    prefs.setColorBy({ block: 'kind', sliver: 'category' });
    prefs.setWeekDays(5);
    prefs.setSplit(true);

    expect(storage.getItem('hub-pos-calendar-color-block')).toBe('kind');
    expect(storage.getItem('hub-pos-calendar-color-sliver')).toBe('category');
    expect(storage.getItem('hub-pos-calendar-week-days')).toBe('5');
    expect(storage.getItem('hub-pos-calendar-split')).toBe('1');
    expect(prefs.blockColorBy).toBe('kind');
    expect(prefs.sliverColorBy).toBe('category');
    expect(prefs.weekDays).toBe(5);
    expect(prefs.split).toBe(true);
  });

  it('a different namespace gets its own keys, independent of "pos"', () => {
    const storage = mockStorage();
    vi.stubGlobal('localStorage', storage);
    const prefs = createCalendarPrefs('scheduling');

    prefs.setSplit(true);

    expect(storage.getItem('hub-scheduling-calendar-split')).toBe('1');
    expect(storage.getItem('hub-pos-calendar-split')).toBeNull();
  });

  // TODO(handoff): "reads back a persisted preference on init" and "ignores
  // an out-of-range stored week-days value" are exactly the `$effect` bodies
  // this harness can't execute (see the file doc comment) — both are real
  // behaviour (the POS page has shipped on them since 2026-09-25) but can only
  // be verified live, not by a unit test here. Covered by this slice's
  // required browser verification instead.
});
