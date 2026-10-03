// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Fixture from './Popover.viewport.fixture.svelte';

afterEach(() => cleanup());

describe('Popover viewport containment', () => {
  it('mounts an opt-in fixed panel with viewport bounds and keeps Escape/focus behavior', async () => {
    render(Fixture, { props: { viewportContained: true } });
    const trigger = screen.getByRole('button', { name: 'Open panel' });

    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const content = screen.getByTestId('panel-body').parentElement as HTMLElement;
    const positioner = content.parentElement as HTMLElement;
    expect(positioner.classList.contains('viewport-contained')).toBe(true);
    expect(positioner.style.position).toBe('fixed');
    expect(positioner.style.minWidth).toBe('0');
    expect(positioner.style.maxWidth).toContain('--available-width');
    expect(positioner.style.maxHeight).toContain('--available-height');
    expect(content.classList.contains('viewport-contained-content')).toBe(true);

    content.focus();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('leaves the shared default positioning contract unchanged', async () => {
    render(Fixture);
    const trigger = screen.getByRole('button', { name: 'Open panel' });
    await fireEvent.click(trigger);

    const content = screen.getByTestId('panel-body').parentElement as HTMLElement;
    const positioner = content.parentElement as HTMLElement;
    expect(positioner.classList.contains('viewport-contained')).toBe(false);
    expect(positioner.style.minWidth).toBe('');
    expect(positioner.style.maxWidth).toBe('');
    expect(content.classList.contains('viewport-contained-content')).toBe(false);
  });
});
