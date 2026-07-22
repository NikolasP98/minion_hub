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
    // With no transition to await, enable on first entry and leave the child
    // popover's own intent/grace timer in charge of closing. Disabling here on
    // leave would remove the panel before the pointer can cross its gap.
    complete: reducedMotion ? current.complete || intent : current.complete,
  };
}

/** Settle the gate to whichever direction the CSS transition just completed. */
export function settleRevealTransition(current: RevealGate): RevealGate {
  return { ...current, complete: current.intent };
}
