// @vitest-environment happy-dom
// HC-029: the ⋯ "Show / hide ranges" menu is a composite widget (WAI-ARIA menu with
// menuitemcheckbox + menuitemradio rows). Keyboard contract exercised against the
// mounted component; the native Chromium twin lives in scripts/qa/hc029/.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import DateRangeControls from './DateRangeControls.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TRIGGER = 'Show / hide ranges';

/** Zag schedules focus/highlight through rAF + microtasks; let them land. */
async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 40));
  await tick();
}

function mount() {
  const onChange = vi.fn();
  const view = render(DateRangeControls, {
    props: { from: '2026-09-01', to: '2026-09-30', periods: [], timeZone: 'UTC', onChange },
  });
  const trigger = view.getByRole('button', { name: TRIGGER });
  return { view, onChange, trigger };
}

const menuEl = () => document.querySelector<HTMLElement>('[role="menu"]');
const isOpen = () => {
  const el = menuEl();
  return !!el && !el.hidden;
};
const activeItem = () => {
  const el = menuEl();
  const id = el?.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};
const items = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'));

describe('DateRangeControls ⋯ menu keyboard contract (HC-029)', () => {
  it('Enter on the trigger opens the menu, moves focus into it and highlights the first range', async () => {
    const { trigger } = mount();
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await settle();
    expect(isOpen()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menuEl()!.contains(document.activeElement)).toBe(true);
    expect(activeItem()).toBe(items()[0]);
    expect(items()[0].getAttribute('role')).toBe('menuitemcheckbox');
    expect(items()[0].getAttribute('aria-checked')).toBe('true'); // 1d is visible by default
  });

  it('the context-menu key on a quick pill opens the same menu with focus inside it', async () => {
    const { view } = mount();
    const pill = view.getByRole('button', { name: '7d' });
    pill.focus();
    await fireEvent.contextMenu(pill);
    await settle();
    expect(isOpen()).toBe(true);
    expect(menuEl()!.contains(document.activeElement)).toBe(true);
  });

  it('ArrowDown/ArrowUp/Home/End move the active item across every row', async () => {
    const { trigger } = mount();
    await fireEvent.click(trigger);
    await settle();
    const menu = menuEl()!;
    const all = items();
    expect(all.length).toBe(22); // 11 ranges × (toggle + default)
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await settle();
    expect(activeItem()).toBe(all[0]);
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await settle();
    expect(activeItem()).toBe(all[1]);
    expect(all[1].getAttribute('role')).toBe('menuitemradio');
    await fireEvent.keyDown(menu, { key: 'End' });
    await settle();
    expect(activeItem()).toBe(all[all.length - 1]);
    await fireEvent.keyDown(menu, { key: 'ArrowUp' });
    await settle();
    expect(activeItem()).toBe(all[all.length - 2]);
    await fireEvent.keyDown(menu, { key: 'Home' });
    await settle();
    expect(activeItem()).toBe(all[0]);
    expect(all[0].hasAttribute('data-highlighted')).toBe(true);
  });

  it('Space toggles a range pill and Enter sets the default; the menu stays open', async () => {
    const { view, trigger } = mount();
    await fireEvent.click(trigger);
    await settle();
    const menu = menuEl()!;
    expect(view.queryByRole('button', { name: '1d' })).not.toBeNull();
    await fireEvent.keyDown(menu, { key: 'ArrowDown' }); // → "1d" toggle
    await settle();
    await fireEvent.keyDown(menu, { key: ' ' });
    await settle();
    expect(items()[0].getAttribute('aria-checked')).toBe('false');
    expect(view.queryByRole('button', { name: '1d' })).toBeNull(); // pill gone
    expect(isOpen()).toBe(true);
    await fireEvent.keyDown(menu, { key: ' ' }); // back on
    await settle();
    expect(items()[0].getAttribute('aria-checked')).toBe('true');
    expect(view.queryByRole('button', { name: '1d' })).not.toBeNull();

    await fireEvent.keyDown(menu, { key: 'ArrowDown' }); // → "1d" default (radio)
    await settle();
    expect(items()[1].getAttribute('aria-checked')).toBe('false');
    await fireEvent.keyDown(menu, { key: 'Enter' });
    await settle();
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
    expect(isOpen()).toBe(true);
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const { trigger } = mount();
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await settle();
    expect(isOpen()).toBe(true);
    await fireEvent.keyDown(document.activeElement ?? menuEl()!, { key: 'Escape' });
    await settle();
    expect(isOpen()).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab closes the menu without trapping: default not prevented, focus back on the trigger as the sequential-navigation origin', async () => {
    const { trigger } = mount();
    await fireEvent.click(trigger);
    await settle();
    expect(isOpen()).toBe(true);
    const notPrevented = await fireEvent.keyDown(menuEl()!, { key: 'Tab' });
    await settle();
    expect(notPrevented).toBe(true);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
