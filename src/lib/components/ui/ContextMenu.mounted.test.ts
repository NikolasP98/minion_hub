// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';

afterEach(() => cleanup());

const items: ContextMenuItem[] = [
  { id: 'charge', label: 'Cobrar' },
  {
    id: 'split',
    label: 'Dividir',
    children: [
      { id: 'split-all', label: 'Dividir todo' },
      { id: 'split-b2', label: 'Dividir Peeling' },
    ],
  },
  { id: 'unschedule', label: 'Desagendar', danger: true },
];

function open(overrides: Partial<{ x: number; y: number; items: ContextMenuItem[] }> = {}) {
  const onselect = vi.fn();
  const onclose = vi.fn();
  render(ContextMenu, {
    props: { x: 100, y: 40, items, label: 'Acciones de la cita', onselect, onclose, ...overrides },
  });
  return { onselect, onclose, menu: screen.getByRole('menu', { name: 'Acciones de la cita' }) };
}

describe('ContextMenu', () => {
  it('opens at the pointer and focuses its first row', async () => {
    const { menu } = open();
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('40px');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Cobrar' })),
    );
  });

  it('closes on Escape and on an outside pointerdown', async () => {
    const { onclose } = open();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
    await fireEvent.pointerDown(document.body);
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it('opens the submenu on ArrowRight and closes it again on ArrowLeft', async () => {
    open();
    const parent = screen.getByRole('menuitem', { name: /Dividir/ });
    expect(parent.getAttribute('aria-haspopup')).toBe('menu');
    expect(parent.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const sub = await screen.findByRole('menuitem', { name: 'Dividir todo' });
    await waitFor(() => expect(document.activeElement).toBe(sub));

    await fireEvent.keyDown(sub, { key: 'ArrowLeft' });
    await waitFor(() => expect(parent.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByRole('menuitem', { name: 'Dividir todo' })).toBeNull();
  });

  it('selects a leaf row, never the submenu parent', async () => {
    const { onselect } = open();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Desagendar' }));
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'unschedule' }));

    onselect.mockClear();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Dividir/ }));
    expect(onselect).not.toHaveBeenCalled();

    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Dividir Peeling' }));
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'split-b2' }));
  });

  it('walks its own rows with Up/Down, wrapping, and never enters a closed submenu', async () => {
    open();
    const charge = screen.getByRole('menuitem', { name: 'Cobrar' });
    await fireEvent.keyDown(charge, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Dividir/ }));

    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(charge);
    await fireEvent.keyDown(charge, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Desagendar' }));
  });

  it('ignores a disabled row', async () => {
    const { onselect } = open({ items: [{ id: 'off', label: 'No disponible', disabled: true }] });
    const row = screen.getByRole('menuitem', { name: 'No disponible' });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.keyDown(row, { key: 'Enter' });
    expect(onselect).not.toHaveBeenCalled();
  });
});
