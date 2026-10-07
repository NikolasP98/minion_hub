/**
 * WAI-ARIA button keyboard contract for elements that must stay `role="button"`
 * because a native button cannot wrap them (interactive content nested inside,
 * drag sources, backdrops). HC-027.
 *
 * - Enter activates on keydown; Space activates on keyup (keydown only swallows
 *   the page scroll) — the same timing a native `<button>` has.
 * - Activation defaults to `currentTarget.click()` so the element's own click
 *   handler stays the single activation path (keyboard == click, exactly once).
 * - Keys bubbling from NESTED controls are ignored (`target !== currentTarget`),
 *   so Enter on a child Button never also activates the parent (HC-026 lesson).
 * - Space only fires when its keydown landed on the same element, matching the
 *   native "pressed" guard against a keyup that arrives after a focus move.
 *
 * Usage: `<div role="button" tabindex="0" onclick={…} {...buttonKeys()}>`.
 */
const spaceArmed = new WeakSet<EventTarget>();

export function buttonKeys(activate: (el: HTMLElement) => void = (el) => el.click()): {
  onkeydown: (e: KeyboardEvent) => void;
  onkeyup: (e: KeyboardEvent) => void;
} {
  return {
    onkeydown(e) {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        activate(e.currentTarget as HTMLElement);
      } else if (e.key === ' ') {
        e.preventDefault();
        spaceArmed.add(e.currentTarget as EventTarget);
      }
    },
    onkeyup(e) {
      if (e.target !== e.currentTarget || e.key !== ' ') return;
      const el = e.currentTarget as HTMLElement;
      if (!spaceArmed.delete(el)) return;
      e.preventDefault();
      activate(el);
    },
  };
}
