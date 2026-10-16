import { page } from '$app/state';
import { preferenceKey } from '$lib/state/ui/scoped-preference.svelte';
// @vitest-environment happy-dom
/**
 * Regression (owner report 2026-10-13, "generally, nothing is working in this
 * view"): `/pos/appointments` mirrors its staff filter into `prefs.staff` from
 * an `$effect`, so that setter has to be safe to call from one. `setStaff`
 * persisted `JSON.stringify(staff)` — reading the state back after writing it
 * inside the same effect, which makes the effect depend on what it just
 * invalidated. Svelte aborts with `effect_update_depth_exceeded` and tears the
 * page down, in the calendar, table AND board views alike.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import StaffPrefSyncHarness from './__fixtures__/StaffPrefSyncHarness.svelte';

beforeEach(() => {
  page.data = { user: { id: 'actor' }, activeOrgId: 'org' };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('staff filter → preference mirror', () => {
  it('mirrors the selection from an $effect without an update-depth loop', async () => {
    const r = render(StaffPrefSyncHarness, { selection: [] });
    await tick();
    expect(r.getByTestId('staff').textContent).toBe('');

    await r.rerender({ selection: ['milagros', 'renzo'] });
    await tick();
    expect(r.getByTestId('staff').textContent).toBe('milagros,renzo');
    expect(localStorage.getItem(preferenceKey('calendar:staff')!)).toBe('["milagros","renzo"]');
  });
});
