// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
vi.mock('$app/state', async () => ({
  page: (await import('./__fixtures__/preference-owner.svelte')).testPage,
}));
import { testPage } from './__fixtures__/preference-owner.svelte';
import { createScopedPreference, preferenceKey } from './scoped-preference.svelte';
import { createCardFields } from '$lib/components/data-view/card-fields.svelte';
import { createCalendarPrefs } from '$lib/components/scheduling/kit/calendar-prefs.svelte';

beforeEach(() => {
  localStorage.clear();
  flushSync(() => {
    testPage.data.user.id = 'actor-a';
    testPage.data.activeOrgId = 'org-a';
  });
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
describe('scoped preferences', () => {
  it('isolates actor and organization immediately, including without remount', () => {
    const pref = createScopedPreference(
      'layout',
      () => 'default',
      (v) => (typeof v === 'string' ? v : 'default'),
    );
    pref.set('a');
    flushSync(() => {
      testPage.data.user.id = 'actor-b';
    });
    expect(pref.value).toBe('default');
    pref.set('b');
    flushSync(() => {
      testPage.data.activeOrgId = 'org-b';
    });
    expect(pref.value).toBe('default');
    pref.set('b-other-org');
    flushSync(() => {
      testPage.data.user.id = 'actor-a';
      testPage.data.activeOrgId = 'org-a';
    });
    expect(pref.value).toBe('a');
  });
  it('does not import unattributable keys; malformed/denied storage is recoverable', () => {
    localStorage.setItem('layout', JSON.stringify('legacy'));
    const pref = createScopedPreference(
      'layout',
      () => 'default',
      (v) => (typeof v === 'string' ? v : 'default'),
    );
    expect(pref.value).toBe('default');
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    pref.set('session');
    expect(pref.value).toBe('session');
    expect(pref.persisted).toBe(false);
  });
  it('normalizes malformed card arrays and refuses unknown commands', () => {
    localStorage.setItem(
      preferenceKey('cards:test')!,
      JSON.stringify({ version: 1, order: 'bad', hidden: {} }),
    );
    const cards = createCardFields('test', ['a', 'b']);
    expect(cards.order).toEqual(['a', 'b']);
    cards.toggle('unknown');
    cards.move('unknown', 'a');
    expect(cards.visible).toEqual(['a', 'b']);
  });
  it('rehydrates calendar values and shares staff inside only the same scope', () => {
    const pos = createCalendarPrefs('pos');
    pos.setWeekDays(5);
    pos.setStaff(['a', 'a']);
    expect(createCalendarPrefs('pos').weekDays).toBe(5);
    expect(createCalendarPrefs('scheduling').staff).toEqual(['a']);
    pos.setPxPerHour(Number.NaN);
    expect(Number.isFinite(pos.pxPerHour)).toBe(true);
    flushSync(() => {
      testPage.data.activeOrgId = 'org-b';
    });
    expect(pos.weekDays).toBe(7);
    expect(pos.staff).toEqual([]);
  });
});
