// @vitest-environment happy-dom
/**
 * Spec 152 PR B — an open menu or list is one tab stop; arrows, Home, End and type-ahead
 * move inside it; closing returns focus to what opened it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import Fixture from './menus.a11y.fixture.svelte';
import { assertPattern } from '$lib/a11y/assert-pattern';
import { rovingTarget } from '$lib/a11y/roving';

afterEach(cleanup);

async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 30));
  await tick();
}

describe('rovingTarget', () => {
  const items = ['Alpha', 'Beta', 'Bravo'].map((text) => {
    const el = document.createElement('button');
    el.textContent = text;
    return el;
  });
  const key = (k: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key: k, ...init });

  it('wraps with the arrows and jumps with Home / End', () => {
    expect(rovingTarget(key('ArrowDown'), items, items[2])).toBe(items[0]);
    expect(rovingTarget(key('ArrowUp'), items, items[0])).toBe(items[2]);
    expect(rovingTarget(key('Home'), items, items[2])).toBe(items[0]);
    expect(rovingTarget(key('End'), items, items[0])).toBe(items[2]);
  });

  it('type-ahead cycles through the items starting with the letter', () => {
    expect(rovingTarget(key('b'), items, items[0])).toBe(items[1]);
    expect(rovingTarget(key('b'), items, items[1])).toBe(items[2]);
    expect(rovingTarget(key('b'), items, items[2])).toBe(items[1]);
  });

  it('leaves Space, Enter, shortcuts and unknown letters alone', () => {
    for (const k of [' ', 'Enter', 'z']) expect(rovingTarget(key(k), items, items[0])).toBeNull();
    expect(rovingTarget(key('b', { ctrlKey: true }), items, items[0])).toBeNull();
  });
});

describe('ContextMenu (spec 152)', () => {
  it('follows the menu pattern, with type-ahead, and returns focus to its opener', async () => {
    const view = render(Fixture, { props: { kind: 'context' } });
    const opener = view.container.querySelector<HTMLElement>('[data-opener]')!;
    opener.focus();
    await fireEvent.click(opener);
    await settle();
    const menu = screen.getByRole('menu', { name: 'Appointment actions' });
    await assertPattern(menu, 'menu', { opener, typeahead: true });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('skips a disabled row instead of stopping on it', async () => {
    const view = render(Fixture, { props: { kind: 'context' } });
    await fireEvent.click(view.container.querySelector<HTMLElement>('[data-opener]')!);
    await settle();
    const split = screen.getByRole('menuitem', { name: /^Split/ });
    split.focus();
    await fireEvent.keyDown(split, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Unschedule' }));
  });
});

describe('MultiSelectFilter (spec 152)', () => {
  it('opens a named multi-select listbox that is one tab stop with arrows and type-ahead', async () => {
    render(Fixture, { props: { kind: 'filter' } });
    await fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    await settle();
    const list = screen.getByRole('listbox', { name: 'Status' });
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    await assertPattern(list, 'listbox', { typeahead: true });
  });

  it('names each remove button after what it removes', async () => {
    render(Fixture, { props: { kind: 'filter' } });
    expect(screen.getByRole('button', { name: 'Remove Open' })).toBeTruthy();
  });
});
