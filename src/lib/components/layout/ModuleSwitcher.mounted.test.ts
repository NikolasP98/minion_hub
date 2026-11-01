// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/state', () => ({
  page: {
    data: {
      landingPage: '/overview',
      user: { role: 'admin' },
      permissions: { permissions: [], roles: ['admin'] },
      activeOrgKind: 'business',
    },
    url: new URL('http://localhost/pos/sell'),
  },
}));
vi.mock('$app/navigation', () => ({ goto: nav.goto, invalidate: vi.fn() }));

import ModuleSwitcher from './ModuleSwitcher.svelte';

const settle = async () => {
  await tick();
  await new Promise((r) => setTimeout(r, 0));
};
const menuEl = () => document.querySelector<HTMLElement>('[role="menu"]:not([hidden])');
const items = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) =>
    el.textContent?.trim(),
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  nav.goto.mockReset();
});

describe('ModuleSwitcher (spec 046 US4)', () => {
  it('lists Inicio first; picking it goes to the landing page and leaves the nav mode alone', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = render(ModuleSwitcher);
    expect(items()[0]).toBe('Home');

    const trigger = container.querySelector<HTMLElement>('[data-part="trigger"]')!;
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await settle();
    const menu = menuEl()!;
    const id = menu.getAttribute('aria-activedescendant');
    if (document.getElementById(id ?? '')?.textContent?.trim() !== 'Home') {
      await fireEvent.keyDown(menu, { key: 'Home' });
      await settle();
    }
    await fireEvent.keyDown(menu, { key: 'Enter' });
    await settle();

    expect(nav.goto).toHaveBeenCalledWith('/overview');
    expect(setItem).not.toHaveBeenCalledWith('hub-nav-mode', expect.anything());
  });
});
