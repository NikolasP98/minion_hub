// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewPref } from './view-pref.svelte';

const KEY = 'test-view-pref';
const VIEWS = ['table', 'board'] as const;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createViewPref', () => {
  it('reads the saved value and writes on set', () => {
    localStorage.setItem(KEY, 'board');
    const pref = createViewPref(KEY, VIEWS, 'table');
    expect(pref.value).toBe('board');
    pref.set('table');
    expect(pref.value).toBe('table');
    expect(localStorage.getItem(KEY)).toBe('table');
  });

  it('falls back when the stored value is not in the whitelist', () => {
    localStorage.setItem(KEY, 'kanban');
    expect(createViewPref(KEY, VIEWS, 'table').value).toBe('table');
  });

  it('falls back and keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const pref = createViewPref(KEY, VIEWS, 'table');
    expect(pref.value).toBe('table');
    pref.set('board');
    expect(pref.value).toBe('board');
  });
});
