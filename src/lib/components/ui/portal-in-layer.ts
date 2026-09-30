import { portal } from '@zag-js/svelte';

/**
 * Zag's `portal`, with two rules on top:
 *
 * 1. A floating panel born inside a native `<dialog>` stays INSIDE that
 *    dialog instead of moving to `<body>`.
 *
 *    A modal `<dialog>` (the detail drawers) lives in the browser's top layer,
 *    which paints above every z-index in the document — so a popover portalled
 *    to `<body>` can never appear over it, however high its layer token. Mounting
 *    into the dialog keeps the panel in the same top-layer element, after the
 *    dialog's own content in DOM order, which is all the stacking it needs.
 *    Outside a dialog this is exactly `use:portal` (owner report 2026-09-26: the
 *    drawer's "Add tag" popover opened underneath the drawer).
 *
 * 2. A nested panel gets ONE stacking tier above its host, set directly on
 *    THIS positioner (never relying on Zag's own content→positioner
 *    `--z-index` copy — Dropdown/Tooltip already set an explicit
 *    `style:z-index` here that would just win the tie-break anyway, and
 *    that copy mechanism only fires for content whose OWN class carries a
 *    z-index, which not every consumer's content div does).
 *
 *    Dropdown, Popover and Tooltip all resolve to the SAME `--layer-modal`
 *    token. Two of them are ALWAYS mounted (hidden only by the `hidden`
 *    attribute, never `{#if open}` — Tooltip is the one exception, and
 *    changing that for the other two breaks `ProfileMenu.test.ts`'s SSR
 *    assertions, which expect a closed menu's items present in server HTML).
 *    So when a Dropdown/Select is opened FROM INSIDE another portaled
 *    panel's content (e.g. FilterChip's "…" kebab menu, opened from inside
 *    its own Popover panel), both positioners tie on equal z-index and the
 *    tie falls back to DOM order — which for two always-mounted positioners
 *    reflects component MOUNT order, not which one the user actually opened
 *    last (owner report 2026-09-29: the kebab's "Delete filter" menu painted
 *    UNDER its own popover). Detecting the nesting via `closest()` on the
 *    positioner's ORIGINAL (pre-portal) ancestor chain — which still holds
 *    regardless of which side's portal action has already fired, since
 *    moving a subtree with `appendChild` never breaks its own internal
 *    parent/child relationships — and bumping just the nested one removes
 *    the tie instead of depending on mount-order luck.
 */
export function portalInLayer(node: HTMLElement) {
  // Decided BEFORE the portal moves the node: afterwards the host content is
  // no longer an ancestor.
  const nested = node.closest('[data-part="content"]') != null;
  const layer = nested ? 'calc(var(--layer-modal) + 1)' : 'var(--layer-modal)';
  // Zag re-applies the positioner's inline `style` on every reposition
  // (`z-index: var(--z-index)`, with `--z-index` copied from the CONTENT's
  // computed z-index), so a value written on the positioner alone is wiped on
  // the first move (shipped: every Dropdown painted under the sticky table
  // header). The content keeps its inline style, so the level lives THERE
  // and reaches the positioner through Zag's own copy; the positioner write
  // only covers the frames before the first reposition.
  node.style.setProperty('z-index', layer);
  const content = node.querySelector<HTMLElement>('[data-part="content"]');
  content?.style.setProperty('z-index', layer);
  content?.style.setProperty('position', 'relative');
  return portal(node, { container: node.closest('dialog') ?? undefined });
}
