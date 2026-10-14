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

/**
 * Three levels deep with radio/checkbox leaves — the shape the calendar's
 * "Event display" branch needs (owner 2026-10-13). A submenu used to be a flat
 * list of plain buttons, so a grandchild could neither nest nor show state.
 */
describe('ContextMenu — nested branches and choice rows', () => {
  const nested: ContextMenuItem[] = [
    { id: 'charge', label: 'Cobrar' },
    {
      id: 'display',
      label: 'Apariencia del evento',
      children: [
        {
          id: 'display:block',
          label: 'Color del bloque',
          children: [
            { id: 'display:block:status', label: 'Estado', selection: 'radio', checked: false },
            { id: 'display:block:category', label: 'Categoría', selection: 'radio', checked: true },
          ],
        },
        {
          id: 'display:blockFields',
          label: 'Bloque del evento',
          children: [
            { id: 'display:blockFields:time', label: 'Hora', selection: 'checkbox', checked: true },
            {
              id: 'display:blockFields:tags',
              label: 'Etiquetas',
              selection: 'checkbox',
              checked: true,
              disabled: true,
            },
          ],
        },
      ],
    },
  ];

  it('opens a grandchild submenu and selects a radio row three levels down', async () => {
    const { onselect } = open({ items: nested });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Apariencia del evento' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Color del bloque' }));
    const row = await screen.findByRole('menuitemradio', { name: 'Estado' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByRole('menuitemradio', { name: 'Categoría' }).getAttribute('aria-checked'),
    ).toBe('true');
    await fireEvent.click(row);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: 'display:block:status' }));
  });

  it('exposes field rows as checkboxes and never selects a locked one', async () => {
    const { onselect } = open({ items: nested });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Apariencia del evento' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Bloque del evento' }));
    await fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Etiquetas' }));
    expect(onselect).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hora' }));
    expect(onselect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'display:blockFields:time' }),
    );
  });

  it('walks into and back out of a deep branch with the arrow keys', async () => {
    open({ items: nested });
    const parent = screen.getByRole('menuitem', { name: 'Apariencia del evento' });
    parent.focus();
    await fireEvent.keyDown(parent, { key: 'ArrowRight' });
    const child = await screen.findByRole('menuitem', { name: 'Color del bloque' });
    await waitFor(() => expect(document.activeElement).toBe(child));
    await fireEvent.keyDown(child, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Estado' })),
    );
    // Left closes only the DEEPEST level, so the middle branch stays open.
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(child));
    expect(screen.queryByRole('menuitemradio', { name: 'Estado' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Bloque del evento' })).toBeTruthy();
  });
});
