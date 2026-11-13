import { portal } from '@zag-js/svelte';

/**
 * Shows a `popover="manual"` element in the browser's TOP LAYER while `open`
 * is true, and hides it otherwise. Zag keeps owning the open state, Escape,
 * outside-click and focus ("manual" adds no native light dismiss to fight it).
 *
 * The top layer paints above every z-index and escapes every `overflow`
 * clip, and a popover shown LATER stacks above earlier top-layer elements: a
 * modal `<dialog>`, a DraggableWindow, or the panel a nested menu was opened
 * from. That replaces the z-index tiers this module used to hand out.
 *
 * Zag defers measuring and focusing to a `raf`, while Svelte flushes this
 * action in a microtask, so the panel is already visible when Zag measures it
 * (floating-ui is top-layer aware). Engines without the Popover API (happy-dom
 * in unit tests) leave the panel in normal flow.
 */
export function topLayer(node: HTMLElement, open: boolean) {
  const sync = (next: boolean) => {
    if (typeof node.showPopover !== 'function' || !node.isConnected) return;
    try {
      const shown = node.matches(':popover-open');
      if (next && !shown) node.showPopover();
      else if (!next && shown) node.hidePopover();
    } catch {
      /* `:popover-open` unsupported: normal flow */
    }
  };
  sync(open);
  return { update: sync };
}

/**
 * Zag's `portal` plus `topLayer`. The portal is still needed in the top-layer
 * world:
 *
 * - A panel born inside a native `<dialog>` stays INSIDE that dialog. A modal
 *   dialog makes everything outside its subtree inert, so a panel shown in
 *   the top layer from `<body>` would paint above the drawer but be dead to
 *   input. That was the owner report of 2026-09-26: the drawer's "Add tag"
 *   popover opened underneath the drawer.
 * - Elsewhere the panel moves to `<body>`. Then clicks inside a menu do not
 *   bubble into a clickable host row, and the panel does not inherit its
 *   trigger's text styles. Callers already style the panel through its own
 *   classes, never through an ancestor selector.
 *
 * The portal runs first and the show second, because moving a shown popover
 * hides it.
 */
export function portalInLayer(node: HTMLElement, open: boolean) {
  const moved = portal(node, { container: node.closest('dialog') ?? undefined });
  const layer = topLayer(node, open);
  return { update: layer.update, destroy: moved.destroy };
}
