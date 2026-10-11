import { untrack } from 'svelte';

/**
 * One floating layer at a time.
 *
 * Zag popovers/menus already dismiss each other on interact-outside, so the
 * competing-popout bug is hover-driven: a `Tooltip` opened by hovering a
 * trigger never sees a pointer-leave when the same (or a nearby) trigger opens
 * a popover/menu/dialog, so its label stays up BESIDE the panel (owner report
 * 2026-10-10: the calendar's right-click menu, `ShiftBanner`'s "Otras cajas
 * abiertas"). Hand-rolled `{#if open}` panels have the same problem and are
 * known to no primitive.
 *
 * So every non-tooltip floating panel registers its own root element here
 * while it is open, and `Tooltip` asks whether it is still allowed to open.
 * Central mechanism, no per-site hacks.
 */

// A plain array (not a Set): Svelte 5 proxies arrays, so push/splice are
// reactive, while `$state(new Set())` would need `SvelteSet` for the same.
// DOM nodes are class instances, so they are stored raw, not proxied.
const layers = $state<HTMLElement[]>([]);

/**
 * Call while a panel is OPEN; the returned function unregisters it.
 *
 * `untrack`: every caller registers from inside an `$effect`, and `push` /
 * `indexOf` / `splice` READ the proxied array, so without it the registering
 * effect subscribes to the very list it just wrote and re-runs forever
 * (cleanup unregisters, body registers again — it hung the mounted test).
 * Readers still see the change; only the writer stays unsubscribed.
 */
export function registerLayer(el: HTMLElement): () => void {
  untrack(() => layers.push(el));
  return () =>
    untrack(() => {
      const i = layers.indexOf(el);
      if (i >= 0) layers.splice(i, 1);
    });
}

/**
 * A tooltip may open when nothing else is floating, when its trigger lives
 * INSIDE an open panel (a tooltip on a row of an open menu, or on a field of
 * an open dialog, is not a competing popout), or when the open panel was
 * raised from inside the tooltip's OWN panel (an `interactive` tooltip that
 * hosts a menu — the calendar hover card's shape).
 *
 * shortcut: "inside ANY open layer", not "inside the topmost one", so a
 * tooltip elsewhere in a dialog is not suppressed by a popover opened within
 * that same dialog. Tighten to the last entry if that nesting ever shows the
 * same stacked-label bug.
 *
 * shortcut: the `panelEl` direction is DOM containment, so it covers a panel
 * that renders in place inside the tooltip's content, not one Zag portals out
 * to `<body>` (`portalInLayer`). Nothing in the tree nests a portalled panel
 * in a tooltip today — `BookingCalendar` ~1691 records why that was abandoned
 * — so matching the portalled case would need the layer's own trigger
 * registered alongside it; do that when a site needs it.
 */
export function tooltipAllowed(triggerEl: Element | null, panelEl: Element | null = null): boolean {
  if (layers.length === 0) return true;
  return layers.some(
    (layer) =>
      (triggerEl != null && layer.contains(triggerEl)) ||
      (panelEl != null && layer !== panelEl && panelEl.contains(layer)),
  );
}

/**
 * Action form, for the common case: a panel rendered only while it is open
 * (`{#if open}`), so mounted IS open. One line per panel, no extra state.
 * An always-mounted panel (Zag hides its content with the `hidden` attribute
 * instead) must gate on its own open flag and call `registerLayer` directly.
 */
export function floatingLayer(node: HTMLElement) {
  return { destroy: registerLayer(node) };
}
