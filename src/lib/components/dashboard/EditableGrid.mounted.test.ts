// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { page } from '$app/state';
import * as m from '$lib/paraglide/messages';
import { preferenceKey } from '$lib/state/ui/scoped-preference.svelte';
import { clearDashboardLayoutCache } from './dashboard-layout-cache';
vi.mock('$app/environment', () => ({ browser: true }));
import Fixture from './EditableGrid.fixture.svelte';
beforeEach(() => {
  page.data = { user: { id: 'actor' }, activeOrgId: 'org' };
  clearDashboardLayoutCache();
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"layout":null}')),
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('EditableGrid commands', () => {
  it('loads malformed storage and exposes a keyboard/tap menu with localized card names', async () => {
    localStorage.setItem(preferenceKey('dash:layout:test-grid')!, '{broken');
    const r = render(Fixture);
    await fireEvent.click(r.getByRole('button', { name: m.dash_layout_edit() }));
    const trigger = r.getByRole('button', { name: 'Beta' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() =>
      expect(r.getByRole('menuitem', { name: 'Move Beta earlier' })).toBeTruthy(),
    );
    await fireEvent.click(r.getByRole('menuitem', { name: 'Move Beta earlier' }));
    expect(
      [...r.container.querySelectorAll('[data-grid-id]')].map((el) =>
        el.getAttribute('data-grid-id'),
      ),
    ).toEqual(['b', 'a']);
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Beta'));
    expect(localStorage.getItem(preferenceKey('dash:layout:test-grid')!)).toContain('"version":1');
  });
  it('keeps readonly layouts free of editing controls', () => {
    const r = render(Fixture, { readonly: true });
    expect(r.queryByRole('button', { name: m.dash_layout_edit() })).toBeNull();
  });
  it('marks uncertain org save without replay and reconciles through GET', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new Error('lost');
      return new Response('{"layout":null}');
    });
    vi.stubGlobal('fetch', fetcher);
    const r = render(Fixture, { canSetDefault: true });
    await fireEvent.click(r.getByRole('button', { name: m.dash_layout_edit() }));
    const save = r.getByRole('button', { name: m.dash_layout_save_default() });
    await fireEvent.click(save);
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(true));
    await fireEvent.click(r.getByRole('button', { name: m.design_reconcile() }));
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });
});
