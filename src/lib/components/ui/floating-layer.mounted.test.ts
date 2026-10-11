// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Fixture from './floating-layer.fixture.svelte';

afterEach(() => cleanup());

const hover = (el: Element) => fireEvent.pointerMove(el, { pointerType: 'mouse' });
/** The Tooltip wrapper span around the Popover trigger. */
const tooltipTrigger = () =>
  screen.getByRole('button', { name: /Open panel/ }).closest('span') as HTMLElement;

describe('one floating layer at a time', () => {
  it('suppresses a tooltip while an unrelated popover is open, and restores it after', async () => {
    render(Fixture);
    const toggle = screen.getByTestId('toggle');

    await hover(tooltipTrigger());
    await waitFor(() => expect(screen.getByText('Otras cajas abiertas')).toBeTruthy());

    await fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('Otras cajas abiertas')).toBeNull());

    // Still refuses to reopen while the popover stays open.
    await hover(tooltipTrigger());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Otras cajas abiertas')).toBeNull();

    // Closing it hands the tooltip back — on the NEXT pointer move. The
    // unregister runs in the popover's effect cleanup, so a pointermove
    // dispatched in the same flush would still be suppressed (in the app the
    // user's pointer keeps moving); wait for the flush before re-hovering.
    await fireEvent.click(toggle);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await hover(tooltipTrigger());
    await waitFor(() => expect(screen.getByText('Otras cajas abiertas')).toBeTruthy());
  });

  it('still opens a tooltip whose trigger is INSIDE the open popover', async () => {
    render(Fixture);
    await fireEvent.click(screen.getByTestId('toggle'));
    const inner = screen.getByTestId('inner-trigger').closest('span') as HTMLElement;
    await hover(inner);
    await waitFor(() => expect(screen.getByText('Inside the panel')).toBeTruthy());
  });
});
