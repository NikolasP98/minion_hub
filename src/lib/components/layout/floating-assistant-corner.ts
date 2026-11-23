/** Where the assistant launcher sits relative to space a page reserves in the
 *  bottom-right corner (`cornerReserve`). With `reserve === 0` every function
 *  returns exactly what the launcher computed before the reserve existed. */

export interface Spot {
  left: number;
  top: number;
}

/** Bottom offset of the launcher's default (undragged) place. */
export const defaultBottom = (margin: number, reserve: number): number => margin + reserve;

/** The rendered position for a launcher whose saved/dragged position is `pos`:
 *  unchanged unless its box overlaps the reserved bottom-right square
 *  (`reserve + margin` a side), then raised to sit just above it. The saved
 *  position itself is never touched by this. */
export function raiseAboveReserve(
  pos: Spot,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  reserve: number,
  margin: number,
): Spot {
  if (reserve <= 0) return pos;
  const side = reserve + margin;
  const overlaps = pos.left + size.w > viewport.w - side && pos.top + size.h > viewport.h - side;
  return overlaps ? { left: pos.left, top: viewport.h - size.h - margin - reserve } : pos;
}
