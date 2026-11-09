// These authority sheets own their entire interaction surface, including the
// footer. Ordinary dialogs retain the assistant's existing top-layer behavior.
export const AUTHORITY_DIALOG_CLASS = 'authority-change-dialog';
const authorityDialogSelector = `dialog.${AUTHORITY_DIALOG_CLASS}[open]`;

export function authorityDialogOpen(document: Document): boolean {
  return document.querySelector(authorityDialogSelector) !== null;
}

export function assistantModalHotkeyOptions(suspended: boolean, enabled = true) {
  return { enabled: enabled && !suspended, preventDefault: false, stopPropagation: false };
}

export function runAssistantModalHotkey(
  event: KeyboardEvent,
  isSuspended: () => boolean,
  action: () => void,
) {
  // The engine must not consume the event before this fresh DOM check: native
  // Escape belongs to the dialog even before reactive options have updated.
  if (isSuspended()) return;
  event.preventDefault();
  action();
}

export function ownAssistantModalSurface(
  root: HTMLElement,
  onSuspendedChange?: (suspended: boolean) => void,
) {
  const document = root.ownerDocument;
  const initialHidden = root.hidden;
  const initialInert = root.hasAttribute('inert');
  const initialAriaHidden = root.getAttribute('aria-hidden');
  let live = true;
  let suspended = false;

  function place() {
    if (!live) return;
    const blocked = authorityDialogOpen(document);
    if (blocked !== suspended) {
      suspended = blocked;
      onSuspendedChange?.(blocked);
      root.hidden = blocked || initialHidden;
      root.inert = blocked || initialInert;
      root.toggleAttribute('data-assistant-suspended', blocked);
      if (blocked) root.setAttribute('aria-hidden', 'true');
      else if (initialAriaHidden === null) root.removeAttribute('aria-hidden');
      else root.setAttribute('aria-hidden', initialAriaHidden);
    }
    const host = blocked
      ? document.body
      : (document.querySelector<HTMLElement>('dialog[open]') ?? document.body);
    if (root.parentElement !== host) host.appendChild(root);
    try {
      if (blocked) {
        if (root.matches(':popover-open')) root.hidePopover();
      } else if (!root.hidden && !root.matches(':popover-open')) root.showPopover();
    } catch {
      // Older engines retain the hidden/inert and normal z-index fallback.
    }
  }

  function containsDialog(node: Node) {
    return node instanceof Element && (node.matches('dialog') || node.querySelector('dialog'));
  }

  // Native showModal/close changes `open`. Observe just modal lifecycle changes,
  // not the assistant's own reparenting/hidden attributes or streamed contents.
  // MutationObserver delivery is before paint, without the old 400ms window.
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === 'attributes'
          ? record.target instanceof HTMLDialogElement
          : [...record.addedNodes, ...record.removedNodes].some(containsDialog),
      )
    )
      place();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'class'],
  });
  place();

  return {
    // Recheck synchronously for shortcuts dispatched in the same task that
    // opened a dialog, before its mutation observer has delivered.
    isSuspended() {
      place();
      return suspended;
    },
    destroy() {
      if (!live) return;
      live = false;
      observer.disconnect();
    },
  };
}
