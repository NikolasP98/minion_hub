// @vitest-environment happy-dom
/**
 * Spec 152 PR A — dialogs keep the keyboard: a confirmation is an alertdialog described by
 * its message with first focus on the safe action; the unsaved-changes prompt is one too
 * (Escape did nothing before); a floating window takes focus and gives it back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import Fixture from './dialogs.a11y.fixture.svelte';
import { assertPattern } from '$lib/a11y/assert-pattern';

afterEach(cleanup);

async function settle() {
  await tick();
  await new Promise((r) => setTimeout(r, 30));
  await tick();
}
const dialogEl = () =>
  document.querySelector<HTMLDialogElement>('dialog[open][data-part="positioner"]')!;
/**
 * A native <dialog> closes on Escape through its `cancel` event and finishes closing when
 * its exit animation ends; neither is synthesized by a keydown in happy-dom.
 */
async function pressNative(key: string) {
  const el = dialogEl();
  if (key !== 'Escape' || !el) {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    return;
  }
  el.dispatchEvent(new Event('cancel', { cancelable: true }));
  await settle();
  el.querySelector('.dialog-content')?.dispatchEvent(new Event('animationend'));
  await settle();
}

async function openFixture(kind: 'confirm' | 'guard' | 'window', oncancel = vi.fn()) {
  const view = render(Fixture, { props: { kind, oncancel } });
  const opener = view.container.querySelector<HTMLElement>('[data-opener]')!;
  opener.focus();
  await fireEvent.click(opener);
  await settle();
  return { view, opener, oncancel };
}

describe('ConfirmDialog (spec 152)', () => {
  it('is an alertdialog described by its message, with first focus on Cancel', async () => {
    const { opener } = await openFixture('confirm');
    const el = dialogEl();
    expect(el.getAttribute('role')).toBe('alertdialog');
    const description = document.getElementById(el.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Delete Alpha? This cannot be undone.');
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    await assertPattern(el, 'alertdialog', { opener, press: pressNative });
  });
});

describe('NavigationGuardModal (spec 152)', () => {
  it('is an alertdialog; Escape cancels and focus returns to the page', async () => {
    const { opener, oncancel } = await openFixture('guard');
    const el = dialogEl();
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect([...el.querySelectorAll('footer button')].map((b) => b.textContent?.trim())).toEqual([
      'Cancel',
      'Discard',
      'Save & Leave',
    ]);
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    await assertPattern(el, 'alertdialog', { opener, press: pressNative });
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it('never stacks the generic "discard changes?" prompt on top of itself', async () => {
    await openFixture('guard');
    const el = dialogEl();
    el.dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();
    expect(document.querySelector('dialog[open][data-part="discard-positioner"]')).toBeNull();
  });
});

describe('DraggableWindow (spec 152)', () => {
  it('takes focus when it opens and returns it when it closes', async () => {
    const { view, opener } = await openFixture('window');
    const frame = document.querySelector<HTMLElement>('[data-component="draggable-window"]')!;
    expect(frame.getAttribute('role')).toBe('dialog');
    expect(frame.contains(document.activeElement)).toBe(true);
    const close = [...frame.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Close',
    );
    await fireEvent.click(close!);
    await settle();
    expect(document.querySelector('[data-component="draggable-window"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    view.unmount();
  });
});
