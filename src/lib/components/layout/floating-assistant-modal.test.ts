// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import { getHotkeyManager } from '@tanstack/hotkeys';
import {
  AUTHORITY_DIALOG_CLASS,
  assistantModalHotkeyOptions,
  ownAssistantModalSurface,
  runAssistantModalHotkey,
} from './floating-assistant-modal';

let root: HTMLDivElement;
let owner: ReturnType<typeof ownAssistantModalSurface> | undefined;
let opened: WeakSet<Element>;
let show: ReturnType<typeof vi.fn>;
let hide: ReturnType<typeof vi.fn>;

function dialog(authority = true, open = true) {
  const element = document.createElement('dialog');
  if (authority) element.className = AUTHORITY_DIALOG_CLASS;
  element.open = open;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  opened = new WeakSet();
  show = vi.fn(function (this: HTMLElement) {
    opened.add(this);
  });
  hide = vi.fn(function (this: HTMLElement) {
    opened.delete(this);
  });
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
    return selector === ':popover-open' ? opened.has(this) : matches.call(this, selector);
  });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: show });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: hide });
  root = document.createElement('div');
  root.setAttribute('popover', 'manual');
  root.innerHTML =
    '<section><textarea aria-label="Assistant draft"></textarea><button>Send</button></section>';
  document.body.append(root);
});

afterEach(() => {
  getHotkeyManager().destroy();
  owner?.destroy();
  owner = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('assistant ownership of authority dialogs', () => {
  it('immediately hides and inerts the entire already-open surface without losing its draft', () => {
    dialog();
    const panel = root.firstElementChild;
    const draft = root.querySelector('textarea')!;
    draft.value = 'Keep my unsent conversation';
    opened.add(root);
    owner = ownAssistantModalSurface(root);
    expect(root.hidden).toBe(true);
    expect(root.inert).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(opened.has(root)).toBe(false);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(root.firstElementChild).toBe(panel);
    expect(draft.value).toBe('Keep my unsent conversation');
    expect(root.parentElement).toBe(document.body);
    expect(show).not.toHaveBeenCalled();
  });

  it('responds to modal open and close without polling, restoring the same panel and draft', async () => {
    const modal = dialog(true, false);
    const panel = root.firstElementChild;
    const draft = root.querySelector('textarea')!;
    draft.value = 'Draft survives Cancel';
    owner = ownAssistantModalSurface(root);
    expect(show).toHaveBeenCalledTimes(1);
    modal.open = true;
    await waitFor(() => expect(root.hidden).toBe(true));
    expect(root.inert).toBe(true);
    expect(root.parentElement).toBe(document.body);
    modal.open = false;
    await waitFor(() => expect(root.hidden).toBe(false));
    expect(root.inert).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
    expect(root.hasAttribute('data-assistant-suspended')).toBe(false);
    expect(opened.has(root)).toBe(true);
    expect(root.firstElementChild).toBe(panel);
    expect(draft.value).toBe('Draft survives Cancel');
    // Reparenting and attribute writes must not create an observer loop.
    expect(show).toHaveBeenCalledTimes(2);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('blocks a global shortcut synchronously before the modal observer delivers', () => {
    const modal = dialog(true, false);
    owner = ownAssistantModalSurface(root);
    modal.open = true;
    const toggle = vi.fn();
    if (!owner.isSuspended()) toggle();
    expect(toggle).not.toHaveBeenCalled();
    expect(root.hidden).toBe(true);
    expect(root.inert).toBe(true);
    expect(opened.has(root)).toBe(false);
  });

  it('leaves native Escape uncancelled when an open assistant has stale enabled hotkey options', () => {
    const modal = dialog(true, false);
    owner = ownAssistantModalSurface(root);
    const closeAssistant = vi.fn();
    const manager = getHotkeyManager();
    // Registration is still enabled from the open assistant, just before the
    // modal's observer/reactive option update can disable it.
    manager.register(
      'Escape',
      (event) => runAssistantModalHotkey(event, () => owner!.isSuspended(), closeAssistant),
      assistantModalHotkeyOptions(false, true),
    );
    modal.open = true;
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    expect(modal.dispatchEvent(escape)).toBe(true);
    expect(escape.defaultPrevented).toBe(false);
    expect(closeAssistant).not.toHaveBeenCalled();
    expect(root.hidden).toBe(true);
    expect(assistantModalHotkeyOptions(true, true).enabled).toBe(false);
  });

  it('does not consume Mod+J while suspended and restores its ordinary action afterward', () => {
    const modal = dialog(true, false);
    owner = ownAssistantModalSurface(root);
    const toggle = vi.fn();
    getHotkeyManager().register(
      'Mod+J',
      (event) => runAssistantModalHotkey(event, () => owner!.isSuspended(), toggle),
      { ...assistantModalHotkeyOptions(false), platform: 'linux' },
    );
    const key = () =>
      new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
    modal.open = true;
    const blocked = key();
    expect(modal.dispatchEvent(blocked)).toBe(true);
    expect(blocked.defaultPrevented).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    modal.open = false;
    const allowed = key();
    expect(document.dispatchEvent(allowed)).toBe(false);
    expect(allowed.defaultPrevented).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(root.hidden).toBe(false);
  });

  it('retains ordinary dialog hosting and restores it after an authority dialog is removed', async () => {
    const ordinary = dialog(false);
    owner = ownAssistantModalSurface(root);
    expect(root.parentElement).toBe(ordinary);
    expect(root.hidden).toBe(false);
    expect(root.inert).toBe(false);
    const authority = dialog();
    await waitFor(() => expect(root.hidden).toBe(true));
    expect(root.parentElement).toBe(document.body);
    authority.remove();
    await waitFor(() => expect(root.parentElement).toBe(ordinary));
    expect(root.hidden).toBe(false);
    expect(root.inert).toBe(false);
    expect(opened.has(root)).toBe(true);
  });

  it('stays suspended until every authority dialog closes', async () => {
    const first = dialog();
    const second = dialog();
    owner = ownAssistantModalSurface(root);
    first.open = false;
    await waitFor(() => expect(owner!.isSuspended()).toBe(true));
    expect(root.hidden).toBe(true);
    second.open = false;
    await waitFor(() => expect(root.hidden).toBe(false));
  });

  it('disconnects idempotently and ignores later modal changes after teardown', async () => {
    const modal = dialog(true, false);
    owner = ownAssistantModalSurface(root);
    owner.destroy();
    owner.destroy();
    modal.open = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(root.hidden).toBe(false);
    expect(owner.isSuspended()).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
