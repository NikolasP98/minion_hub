/**
 * Containment of a committed box inside the time track (HC-022).
 *
 * `pack` keeps the box's TRUE `top`/`height` — drags and the fan deck read
 * them, so they are never mutated. This clamps a copy to `[0, trackH]` for
 * RENDERING: the box paints from the track's top edge when it starts before
 * `startHour` and stops at the track's bottom edge when it ends after the
 * last row, and says so (`clippedTop`/`clippedBottom` → the continuation
 * markers + `aria-describedby` text). The hitbox is the visible part only.
 *
 * A box entirely outside the track (ends before `startHour`, starts after
 * the last row) returns `null`: nothing to paint, no phantom 0px button in
 * the tab order. It is still reachable through Table/Board/agenda.
 */
export interface ClippedBox {
  top: number;
  height: number;
  clippedTop: boolean;
  clippedBottom: boolean;
}

/** Same readability floor as `pack` (18px). */
export const MIN_BOX_PX = 18;

export function clipToTrack(
  top: number,
  height: number,
  trackH: number,
  minH = MIN_BOX_PX,
): ClippedBox | null {
  const bottom = top + height;
  if (bottom <= 0 || top >= trackH || trackH <= 0) return null;
  const clippedTop = top < 0;
  const clippedBottom = bottom > trackH;
  let t = clippedTop ? 0 : top;
  let h = Math.min(bottom, trackH) - t;
  // A sliver (05:55–07:05 on a 07:00 grid) keeps the same floor an ordinary
  // short box has, growing INTO the track so it never leaves it again.
  if (h < minH) {
    h = Math.min(minH, trackH);
    if (t + h > trackH) t = trackH - h;
  }
  return { top: t, height: h, clippedTop, clippedBottom };
}
