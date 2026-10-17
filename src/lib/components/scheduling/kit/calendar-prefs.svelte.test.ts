import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from '$app/state';
import { preferenceKey } from '$lib/state/ui/scoped-preference.svelte';
import { createCalendarPrefs, knownStaff } from './calendar-prefs.svelte';
let values: Map<string, string>;
beforeEach(() => {
  page.data = { user: { id: 'actor' }, activeOrgId: 'org' };
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
describe('calendar preferences', () => {
  it('defaults safely and persists validated values inside the owner namespace', () => {
    const prefs = createCalendarPrefs('pos');
    expect([prefs.blockColorBy, prefs.sliverColorBy, prefs.weekDays, prefs.split]).toEqual([
      'status',
      'staff',
      7,
      false,
    ]);
    prefs.setColorBy({ block: 'kind', sliver: 'category' });
    prefs.setWeekDays(5);
    prefs.setSplit(true);
    const saved = JSON.parse(values.get(preferenceKey('calendar:pos')!)!);
    expect(saved).toMatchObject({
      blockColorBy: 'kind',
      sliverColorBy: 'category',
      weekDays: 5,
      split: true,
    });
    expect(values.has('hub-pos-calendar-split')).toBe(false);
  });
  it('rehydrates actual saved values and isolates calendar-specific settings', () => {
    const prefs = createCalendarPrefs('pos');
    prefs.setWeekDays(5);
    prefs.setSplit(true);
    expect(createCalendarPrefs('pos').weekDays).toBe(5);
    expect(createCalendarPrefs('scheduling').split).toBe(false);
  });
  it('clamps finite geometry and rejects malformed custom axes', () => {
    const prefs = createCalendarPrefs('pos');
    prefs.setPxPerHour(999);
    expect(prefs.pxPerHour).toBe(240);
    prefs.setPxPerHour(3.4);
    expect(prefs.pxPerHour).toBe(24);
    prefs.setPxPerHour(NaN);
    expect(prefs.pxPerHour).toBe(56);
    prefs.setWeekDays(Infinity);
    expect(prefs.weekDays).toBe(7);
    prefs.setSubBy('prop:');
    expect(prefs.subBy).toBe('none');
    prefs.setSubBy('prop:abc');
    expect(prefs.subBy).toBe('prop:abc');
    prefs.setBoardBy('unknown');
    expect(prefs.boardBy).toBe('status');
  });
  it('shares staff between calendars only within the current identity', () => {
    const pos = createCalendarPrefs('pos');
    pos.setStaff(['milagros', 'milagros']);
    expect(createCalendarPrefs('scheduling').staff).toEqual(['milagros']);
    expect(values.get(preferenceKey('calendar:staff')!)).toBe('["milagros"]');
    expect(values.has('hub-calendar-staff')).toBe(false);
  });
  it('restricts persisted staff to current resources', () => {
    expect(knownStaff(['a', 'removed'], [{ id: 'a' }])).toEqual(new Set(['a']));
    expect(knownStaff(['removed'], [{ id: 'a' }])).toEqual(new Set());
  });
});
