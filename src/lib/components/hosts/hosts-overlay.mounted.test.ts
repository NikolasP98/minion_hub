// @vitest-environment happy-dom
/**
 * HC-028 — HostsOverlay must satisfy the shared dialog contract
 * (`$lib/components/ui/foundations/Dialog.svelte`): native `<dialog>` opened
 * with `showModal()`, body scroll locked while open, Escape from an INNER
 * input closes it, backdrop click dismisses, focus returns to the trigger.
 *
 * happy-dom has no user agent: `showModal()` only sets `[open]`, nothing
 * traps Tab or turns Escape into `cancel`. `installUserAgentEscape` plays
 * that one UA role (a document-level Escape that reached the top becomes a
 * `cancel` on the open modal dialog) so the swallow is observable here; the
 * `:modal`/inert/Tab-trap half is proved in real Chromium by
 * `tests/fixtures/overlay-dialog/verify.mjs`.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { ui } from '$lib/state/ui/ui.svelte';
import HostsOverlay from './HostsOverlay.svelte';

vi.mock('$lib/services/gateway.svelte', () => ({ wsConnect: vi.fn(), wsDisconnect: vi.fn() }));
vi.mock('$lib/state/gateway/connection.svelte', () => ({
  conn: { connected: false, connectError: null },
}));
vi.mock('$lib/state/features/hosts.svelte', () => ({
  hostsState: {
    hosts: [{ id: 'h1', name: 'alpha', url: 'wss://alpha.example', lastConnectedAt: null }],
    activeHostId: 'h1',
  },
  addHost: vi.fn(),
  updateHost: vi.fn(),
  removeHost: vi.fn(),
}));

/** The UA half of Escape: a keydown that bubbles to the document un-cancelled
 *  fires `cancel` on the open modal dialog (what Chromium's close watcher does). */
function installUserAgentEscape() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    document.querySelector<HTMLDialogElement>('dialog[open]')?.dispatchEvent(
      new Event('cancel', { cancelable: true }),
    );
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

let trigger: HTMLButtonElement;
let uninstall: () => void;
let showModal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  trigger = document.createElement('button');
  trigger.id = 'open-hosts';
  document.body.append(trigger);
  trigger.focus();
  uninstall = installUserAgentEscape();
  showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
  ui.overlayOpen = true;
});
afterEach(() => {
  cleanup();
  uninstall();
  trigger.remove();
  showModal.mockRestore();
  ui.overlayOpen = false;
});

it('opens as a native modal dialog with the body scroll locked', () => {
  render(HostsOverlay);
  expect(showModal).toHaveBeenCalledTimes(1);
  const dialog = document.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
});

it('closes on Escape pressed INSIDE the URL input (the swallow this finding names)', async () => {
  render(HostsOverlay);
  const input = document.querySelector<HTMLInputElement>('#host-url')!;
  input.focus();
  await fireEvent.keyDown(input, { key: 'Escape' });
  expect(ui.overlayOpen).toBe(false);
});

it('dismisses on backdrop click but not on a click inside the content', async () => {
  render(HostsOverlay);
  await fireEvent.click(document.querySelector('#host-url')!);
  expect(ui.overlayOpen).toBe(true);
  await fireEvent.click(document.querySelector('dialog')!);
  expect(ui.overlayOpen).toBe(false);
});

it('releases the scroll lock and returns focus to the trigger once closed', async () => {
  const view = render(HostsOverlay);
  await fireEvent.click(document.querySelector('dialog')!);
  expect(ui.overlayOpen).toBe(false);
  // The root layout unmounts HostsOverlay when `ui.overlayOpen` flips.
  view.unmount();
  await tick();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(trigger);
});
