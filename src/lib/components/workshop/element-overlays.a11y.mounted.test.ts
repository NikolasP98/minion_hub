// @vitest-environment happy-dom
/**
 * Spec 155 PR C: the five workshop element panels are real modal dialogs (the shared Dialog):
 * named by their own title; Escape closes them. First focus is the browser's own (showModal),
 * which happy-dom does not perform: that part is proven with real keys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import InboxOverlay from './InboxOverlay.svelte';
import MessageBoardOverlay from './MessageBoardOverlay.svelte';
import PinboardOverlay from './PinboardOverlay.svelte';
import PortalOverlay from './PortalOverlay.svelte';
import RulebookOverlay from './RulebookOverlay.svelte';

afterEach(cleanup);
const settle = async () => {
  await tick();
  await new Promise((r) => setTimeout(r, 20));
  await tick();
};
type Overlay = Component<{ elementId: string; onClose: () => void }>;
const OVERLAYS: [string, Overlay][] = [
  ['inbox', InboxOverlay as Overlay],
  ['message board', MessageBoardOverlay as Overlay],
  ['pinboard', PinboardOverlay as Overlay],
  ['portal', PortalOverlay as Overlay],
  ['rulebook', RulebookOverlay as Overlay],
];

describe.each(OVERLAYS)('workshop %s panel', (_name, Overlay) => {
  it('is a modal dialog named by its visible title', async () => {
    render(Overlay, { props: { elementId: 'el-1', onClose: vi.fn() } });
    await settle();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toMatch(
      /\S/,
    );
    expect(dialog.querySelector('[role="button"][aria-label]')).toBeNull(); // no backdrop "button"
  });

  it('Escape closes it', async () => {
    const onClose = vi.fn();
    render(Overlay, { props: { elementId: 'el-1', onClose } });
    await settle();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    await fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
