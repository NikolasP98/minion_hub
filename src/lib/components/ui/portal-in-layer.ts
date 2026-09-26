import { portal } from '@zag-js/svelte';

/**
 * Zag's `portal`, with one rule on top: a floating panel born inside a native
 * `<dialog>` stays INSIDE that dialog instead of moving to `<body>`.
 *
 * A modal `<dialog>` (the detail drawers) lives in the browser's top layer,
 * which paints above every z-index in the document — so a popover portalled
 * to `<body>` can never appear over it, however high its layer token. Mounting
 * into the dialog keeps the panel in the same top-layer element, after the
 * dialog's own content in DOM order, which is all the stacking it needs.
 * Outside a dialog this is exactly `use:portal` (owner report 2026-09-26: the
 * drawer's "Add tag" popover opened underneath the drawer).
 */
export function portalInLayer(node: HTMLElement) {
  return portal(node, { container: node.closest('dialog') ?? undefined });
}
