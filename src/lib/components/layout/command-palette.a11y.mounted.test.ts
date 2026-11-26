// @vitest-environment happy-dom
/**
 * Spec 152 PR A — the command palette is a named modal dialog (it was a plain div over the
 * page: no name, no focus trap, no focus return) holding a combobox that names its active option.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => true }));
vi.mock('$lib/state/gateway/gateway-data.svelte', () => ({ visibleAgents: { value: [] } }));
vi.mock('$lib/nav/routes', () => ({
  palettePageRoutes: () => [
    { path: '/overview', title: () => 'Overview', paletteIcon: 'home', keywords: 'dashboard' },
    { path: '/settings', title: () => 'Settings', paletteIcon: 'settings', keywords: '' },
  ],
}));

import CommandPalette from './CommandPalette.svelte';
import { palette } from '$lib/state/ui/command-palette.svelte';
import { assertPattern } from '$lib/a11y/assert-pattern';

afterEach(() => {
  palette.open = false;
  cleanup();
});

async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 30));
  await tick();
}

async function openPalette() {
  const opener = document.createElement('button');
  opener.textContent = 'Search';
  document.body.append(opener);
  opener.focus();
  render(CommandPalette);
  palette.query = '';
  palette.selectedIndex = 0;
  palette.open = true;
  await settle();
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
  return { opener, dialog };
}

describe('CommandPalette (spec 152)', () => {
  it('is a named modal dialog; Escape closes it and returns focus', async () => {
    const { opener, dialog } = await openPalette();
    expect(dialog.getAttribute('aria-label')).toBe('Command palette');
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    await assertPattern(dialog, 'dialog', {
      opener,
      press: async (key) => {
        if (key !== 'Escape') return;
        // No `animationend` is dispatched here on purpose: the palette's surface has no exit
        // animation, so the dialog must close without waiting for one.
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        await settle();
      },
    });
    expect(palette.open).toBe(false);
    expect(dialog.open).toBe(false);
    expect(document.querySelector('dialog[open]')).toBeNull();
    opener.remove();
  });

  it('holds a combobox whose active option follows the arrow keys', async () => {
    const { opener, dialog } = await openPalette();
    const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const options = [...dialog.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    // Escape closes the whole dialog (proved above), not just a popup: the list is always open.
    await assertPattern(dialog, 'combobox', { skip: ['escape-closes'] });
    opener.remove();
  });

  it('with no results shows a status, not an empty listbox', async () => {
    const { opener, dialog } = await openPalette();
    palette.query = 'zzzz-no-such-command';
    await settle();
    expect(dialog.querySelector('[role="listbox"]')).toBeNull();
    expect(dialog.querySelector('[role="status"]')?.textContent?.trim()).toBeTruthy();
    expect(dialog.querySelector('[role="combobox"]')?.getAttribute('aria-expanded')).toBe('false');
    opener.remove();
  });
});
