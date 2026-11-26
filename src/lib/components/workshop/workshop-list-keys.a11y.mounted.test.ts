// @vitest-environment happy-dom
/**
 * Spec 154 PR C — what the pointer does on the workshop canvas (move, link, open, remove) is
 * available from the list beside it. The list is the canvas for the keyboard: canvas items
 * have no DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import List from './_workshop-canvas/WorkshopAgentControls.svelte';

afterEach(cleanup);

async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 30));
  await tick();
}

function mount(extra: Record<string, unknown> = {}) {
  const calls = {
    onselect: vi.fn(),
    onassign: vi.fn(),
    onmovestart: vi.fn(),
    onmoveby: vi.fn(),
    onmoveend: vi.fn(),
    onlink: vi.fn(),
    onopen: vi.fn(),
    onremove: vi.fn(),
  };
  const view = render(List, {
    props: {
      agents: [
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Grace' },
      ],
      elements: [{ id: 'e', name: 'Rules' }],
      selectedId: null,
      connected: true,
      ...calls,
      ...extra,
    },
  });
  view.container.querySelector('details')!.open = true;
  return { ...view, calls };
}
async function choose(more: string, item: string) {
  await fireEvent.click(screen.getByRole('button', { name: more }));
  await settle();
  const row = screen.getByRole('menuitem', { name: item });
  await fireEvent.pointerDown(row, { pointerType: 'mouse' });
  await fireEvent.pointerUp(row, { pointerType: 'mouse' });
  await fireEvent.click(row);
  await settle();
  await new Promise((r) => setTimeout(r, 200)); // the menu's own focus return has passed
}
const said = () => document.querySelector('[data-announcer="polite"]')?.textContent ?? '';

describe('workshop list: keyboard path for the canvas', () => {
  it('lists the elements and opens one', async () => {
    const { calls } = mount();
    expect(screen.getByRole('list', { name: 'Elements' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Open: Rules' }));
    expect(calls.onopen).toHaveBeenCalledWith('e');
  });

  it('moves an agent with the arrow keys and drops it with Enter', async () => {
    const { calls } = mount();
    await choose('More actions: Ada', 'Move');
    expect(calls.onmovestart).toHaveBeenCalledWith('agent', 'a');
    expect(said()).toContain('Moving Ada');
    const moving = screen.getByRole('button', { pressed: true });
    expect(document.activeElement).toBe(moving);
    await fireEvent.keyDown(moving, { key: 'ArrowRight' });
    await fireEvent.keyDown(moving, { key: 'ArrowDown', shiftKey: true });
    expect(calls.onmoveby.mock.calls).toEqual([
      [16, 0],
      [0, 64],
    ]);
    await fireEvent.keyDown(moving, { key: 'Enter' });
    expect(calls.onmoveend).toHaveBeenCalledWith(true);
    expect(calls.onmoveend).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(said()).toBe('Ada moved'));
    // Focus does not fall to the page: it is back on the menu the move came from.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'More actions: Ada' }),
      ),
    );
  });

  it('drops the item where it is when focus leaves the move control', async () => {
    const { calls } = mount();
    await choose('More actions: Ada', 'Move');
    const moving = screen.getByRole('button', { pressed: true });
    await fireEvent.keyDown(moving, { key: 'ArrowLeft' });
    screen.getByRole('button', { name: 'Grace' }).focus();
    await new Promise((r) => setTimeout(r, 220));
    expect(calls.onmoveend).toHaveBeenCalledWith(true);
  });

  it('Escape puts a moved element back', async () => {
    const { calls } = mount();
    await choose('More actions: Rules', 'Move');
    expect(calls.onmovestart).toHaveBeenCalledWith('element', 'e');
    await fireEvent.keyDown(screen.getByRole('button', { pressed: true }), { key: 'Escape' });
    expect(calls.onmoveend).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(said()).toBe('Rules is back where it was'));
  });

  it('links one agent to another and removes from the same menu', async () => {
    const { calls } = mount();
    await choose('More actions: Ada', 'Link to Grace…');
    expect(calls.onlink).toHaveBeenCalledWith('a', 'b');
    await choose('More actions: Grace', 'Remove from canvas');
    expect(calls.onremove).toHaveBeenCalledWith('agent', 'b');
    await vi.waitFor(() => expect(said()).toBe('Grace removed from the canvas'));
  });

  it('offers no move or link where items cannot be placed freely', async () => {
    mount({ movable: false });
    await fireEvent.click(screen.getByRole('button', { name: 'More actions: Ada' }));
    await settle();
    expect(screen.queryByRole('menuitem', { name: 'Move' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Link to Grace…' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Remove from canvas' })).toBeTruthy();
  });

  it('keeps select and assign as they were', async () => {
    const { calls } = mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Grace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Assign task: Grace' }));
    expect(calls.onselect).toHaveBeenCalledWith('b');
    expect(calls.onassign).toHaveBeenCalledWith('b');
  });
});
