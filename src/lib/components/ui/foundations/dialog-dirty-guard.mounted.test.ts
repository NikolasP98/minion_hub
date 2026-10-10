// @vitest-environment happy-dom
/**
 * fix/overlay-dirty-guard — Dialog's dirty/discard guard. The POS calendar's
 * "Nueva cita" tray (BookingCreateDrawer → Sheet → Dialog) used to lose the
 * whole in-progress form on a stray backdrop click near a floating Picker, or
 * on Escape leaking out of a DraggableWindow. Dialog now tracks whether the
 * content has unsaved input (`touched`, from native `input`/`change` events)
 * or is told so explicitly (`dirty` prop), and blocks a user-initiated
 * dismissal (backdrop/Escape/close-button) behind a "discard changes?"
 * prompt. A programmatic `open = false` (the host closing after a successful
 * save) is never guarded — see case (d).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import DialogDirtyHarness from './dialog-dirty-harness.svelte';

/** Same UA-Escape simulation as overlay-dialog-contract.mounted.test.ts: a
 *  document-level Escape that reaches the top becomes `cancel` on the open
 *  modal dialog (happy-dom has no close-watcher of its own). */
function installUserAgentEscape() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    document
      .querySelector<HTMLDialogElement>('dialog[open]')
      ?.dispatchEvent(new Event('cancel', { cancelable: true }));
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

function hostDialog(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>('dialog[data-part="positioner"]')!;
}
/** `@minion-stack/ui` Button hardcodes its own `data-part="button"` AFTER
 *  spreading the caller's rest props, so a caller-supplied `data-part` never
 *  reaches the DOM — find the discard prompt's two actions by their (i18n)
 *  label text instead. */
function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    ) ?? null
  );
}
function keepButton(): HTMLButtonElement | null {
  return buttonByText(m.dialog_discardKeep());
}
function discardButton(): HTMLButtonElement | null {
  return buttonByText(m.dialog_discardConfirm());
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = installUserAgentEscape();
});
afterEach(() => {
  cleanup();
  uninstall();
});

describe('Dialog dirty guard — (a) dirty prop blocks backdrop/Escape behind a discard prompt', () => {
  it('backdrop click opens the prompt, keeps the dialog open, and does not call onclose', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, dirty: true, onclose } });

    await fireEvent.click(hostDialog());
    expect(onclose).not.toHaveBeenCalled();
    expect(keepButton()).toBeTruthy();
    expect(document.body.textContent).toContain(m.dialog_discardTitle());
    expect(hostDialog().open).toBe(true);
  });

  it('Escape pressed inside the content opens the prompt and does not call onclose', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, dirty: true, onclose } });

    const input = document.querySelector<HTMLInputElement>('.text-field')!;
    input.focus();
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(onclose).not.toHaveBeenCalled();
    expect(keepButton()).toBeTruthy();
    expect(hostDialog().open).toBe(true);
  });

  it('"Keep editing" returns to the form without closing anything', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, dirty: true, onclose } });

    await fireEvent.click(hostDialog());
    expect(keepButton()).toBeTruthy();
    await fireEvent.click(keepButton()!);

    expect(onclose).not.toHaveBeenCalled();
    expect(keepButton()).toBeNull();
    expect(hostDialog().open).toBe(true);
  });

  it('"Discard changes" closes the dialog and calls onclose with the original reason', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, dirty: true, onclose } });

    await fireEvent.click(hostDialog());
    await fireEvent.click(discardButton()!);

    expect(onclose).toHaveBeenCalledWith('backdrop');
  });
});

describe('Dialog dirty guard — (b)/(c) automatic touched tracking', () => {
  it('(b) typing into a plain text field makes the dialog dirty: a backdrop click prompts', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, onclose } });

    const input = document.querySelector<HTMLInputElement>('.text-field')!;
    await fireEvent.input(input, { target: { value: 'Alpha' } });

    await fireEvent.click(hostDialog());
    expect(onclose).not.toHaveBeenCalled();
    expect(keepButton()).toBeTruthy();
  });

  it('(c) typing into an input[type=search] does not mark the dialog dirty', async () => {
    const onclose = vi.fn();
    render(DialogDirtyHarness, { props: { open: true, onclose } });

    const search = document.querySelector<HTMLInputElement>('.search-field')!;
    await fireEvent.input(search, { target: { value: 'needle' } });

    await fireEvent.click(hostDialog());
    await waitFor(() => expect(onclose).toHaveBeenCalledWith('backdrop'));
    expect(keepButton()).toBeNull();
  });
});

describe('Dialog dirty guard — (d) a programmatic close is never guarded', () => {
  it('open=false from the parent closes immediately while dirty, with no prompt', async () => {
    const onclose = vi.fn();
    const view = render(DialogDirtyHarness, { props: { open: true, dirty: true, onclose } });

    await view.rerender({ open: false, dirty: true, onclose });
    await tick();

    expect(keepButton()).toBeNull();
    // Unbound `open` (same contract as the ExportDialog case in
    // overlay-dialog-contract.mounted.test.ts): the host flips straight to
    // its exit state instead of going through `onclose`.
    expect(hostDialog().hasAttribute('data-closing')).toBe(true);
  });
});
