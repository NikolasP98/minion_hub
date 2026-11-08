// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { inactiveSimulation } from '$lib/role-simulation';
import SimulationFrame from './SimulationFrame.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('simulation viewport perimeter', () => {
  it('renders no frame or exit action in ordinary mode', () => {
    render(SimulationFrame, { state: inactiveSimulation() });
    expect(document.querySelector('[data-role-simulation-frame]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('keeps a pointer-transparent perimeter in the top layer when native dialogs open', async () => {
    const opened = new WeakSet<Element>();
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
      return selector === ':popover-open' ? opened.has(this) : matches.call(this, selector);
    });
    const show = vi.fn(function (this: HTMLElement) {
      opened.add(this);
    });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      configurable: true,
      value: show,
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
      configurable: true,
      value: function (this: HTMLElement) {
        opened.delete(this);
      },
    });
    render(SimulationFrame, {
      state: { ...inactiveSimulation(), active: true, roleKey: 'viewer', roleName: 'Viewer' },
    });
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    const frame = document.querySelector('[data-role-simulation-frame]')!;
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.getAttribute('popover')).toBe('manual');
    expect(screen.getByRole('status').textContent).toContain('Viewer');
    expect(screen.queryByRole('button')).toBeNull();
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.open = true;
    await waitFor(() => expect(show.mock.calls.length).toBeGreaterThan(1));
    dialog.remove();
  });
});
