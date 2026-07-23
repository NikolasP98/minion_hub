export type RevealGate = {
  intent: boolean;
  complete: boolean;
};

/**
 * Update hover/focus intent without prematurely closing an already-settled
 * gate. During normal motion, transition completion owns `complete`; this lets
 * the status popover's close grace bridge the trigger-to-panel pointer gap.
 * Reduced motion has no reliable transitionend, so it settles immediately.
 */
export function setRevealIntent(
  current: RevealGate,
  intent: boolean,
  reducedMotion: boolean,
): RevealGate {
  return {
    intent,
    // With no transition to await, the popup lock included in `intent` owns
    // the close grace and lets the gate settle immediately in either direction.
    complete: reducedMotion ? intent : current.complete,
  };
}

/** Settle the gate to whichever direction the CSS transition just completed. */
export function settleRevealTransition(current: RevealGate): RevealGate {
  return { ...current, complete: current.intent };
}

/**
 * Popups own the notch while open. Pointer/focus intent may disappear while
 * crossing an anchored panel's gap; collapsing before its close grace expires
 * moves the anchor under the cursor and creates a collapse/re-expand loop.
 */
export function shouldExpandIsland(
  pointerInside: boolean,
  focusInside: boolean,
  statusPopoverOpen: boolean,
  notificationsOpen: boolean,
): boolean {
  return pointerInside || focusInside || statusPopoverOpen || notificationsOpen;
}
