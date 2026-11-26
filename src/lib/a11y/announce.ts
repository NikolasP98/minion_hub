/**
 * The ONE screen-reader announcer. Components call `announce(text)` instead of each owning
 * a hidden live region. Pass text that is already translated.
 */
type Politeness = 'polite' | 'assertive';

const regions: Partial<Record<Politeness, HTMLElement>> = {};

function region(politeness: Politeness): HTMLElement {
  let el = regions[politeness];
  if (!el?.isConnected) {
    el = document.createElement('div');
    el.className = 'sr-only';
    el.dataset.announcer = politeness;
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    regions[politeness] = el;
  }
  // Everything outside an open modal <dialog> is inert and is not announced, so the region
  // lives inside the topmost one while it is open.
  const host = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  if (el.parentElement !== host) host.append(el);
  return el;
}

/** Says `message`; `assertive` interrupts and is for steps the user is waiting on. */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  if (typeof document === 'undefined') return;
  const el = region(politeness);
  // Cleared first: the same text twice in a row must be announced twice.
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = message));
}
