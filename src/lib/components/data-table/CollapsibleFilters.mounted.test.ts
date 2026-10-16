// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import Fixture from './CollapsibleFilters.fixture.svelte';

function stubViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: narrow && query.includes('767.98'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const CONTROLS = '[data-filter]';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CollapsibleFilters (collapse by purpose, spec 013)', () => {
  it('renders the filters inline at >= 768px with no trigger', () => {
    stubViewport(false);
    const r = render(Fixture);
    expect(r.container.querySelectorAll(`.inline-filters ${CONTROLS}`)).toHaveLength(3);
    expect(r.queryByRole('button', { name: new RegExp(m.filters_label()) })).toBeNull();
  });

  it('folds every filter into one Sheet below 768px and keeps each control reachable', async () => {
    stubViewport(true);
    const r = render(Fixture, { activeCount: 2 });
    // Nothing inline: the toolbar carries ONE trigger, so it cannot overflow the viewport.
    expect(r.container.querySelectorAll(`.inline-filters ${CONTROLS}`)).toHaveLength(0);
    const trigger = r.getByRole('button', { name: new RegExp(m.filters_label()) });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.textContent).toContain('2');

    await fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    const sheet = document.querySelector('.sheet-filters');
    expect(sheet, 'sheet region').not.toBeNull();
    expect(
      sheet!.closest('dialog, [role="dialog"]'),
      'rendered inside the shared Sheet',
    ).not.toBeNull();
    // Same three controls as inline — none dropped on the way into the sheet.
    expect(sheet!.querySelectorAll(CONTROLS)).toHaveLength(3);
    expect(sheet!.getAttribute('data-action-scope')).toBe('collection');
  });
});
