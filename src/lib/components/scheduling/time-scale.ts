/**
 * Minimum `pxPerHour` for the week/day time axis (owner ask 2026-10-12): at
 * minimum zoom the configured hour range should fill the grid's own visible
 * height instead of leaving the lower half empty, while still never going
 * below the existing hard floor (`PX_PER_HOUR_MIN` in `BookingCalendar.svelte`).
 * Pure so it's testable without mounting the component.
 */
export function minPxPerHour(opts: {
  /** The scroller's measured `clientHeight`; 0 before first measurement. */
  viewportPx: number;
  /** Sticky column-head band height, which doesn't belong to the time track. */
  headPx: number;
  /** Rows on the axis (`HOURS.length`, i.e. `endHour - startHour + 1`). */
  hourCount: number;
  /** The existing hard floor — never clamp below it even on a tiny viewport. */
  floorPx: number;
  /** The scale's hard ceiling (`PX_PER_HOUR_MAX`). A tall grid over a short
   *  hour range can want MORE than the ceiling to fill itself; letting the
   *  minimum pass it would park `pxPerHour` above every value the gutter can
   *  produce, so the zoom gesture stops doing anything at all. */
  ceilPx: number;
}): number {
  if (opts.hourCount <= 0) return Math.min(opts.floorPx, opts.ceilPx);
  const fill = (opts.viewportPx - opts.headPx) / opts.hourCount;
  return Math.min(opts.ceilPx, Math.max(opts.floorPx, Math.floor(fill)));
}
