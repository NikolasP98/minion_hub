/**
 * Where the calendar's "now" rule sits inside a rendered day track.
 *
 * Pure so the window arithmetic (the one thing worth a test) is checkable
 * without a DOM: the component only decides WHICH columns are today and ticks
 * `nowMinutes` forward.
 */

/**
 * Offset in px from the top of a track for `nowMinutes` (minutes from local
 * midnight), or `null` when now falls outside the rendered `[startHour,
 * endHour]` window — both ends inclusive, so a clock sitting exactly on
 * `endHour` still draws on that last hour row.
 */
export function nowLineTop(
  nowMinutes: number,
  startHour: number,
  endHour: number,
  pxPerHour: number,
): number | null {
  const start = startHour * 60;
  if (nowMinutes < start || nowMinutes > endHour * 60) return null;
  return ((nowMinutes - start) / 60) * pxPerHour;
}

/**
 * Minutes from local midnight for a pointer sitting `offsetY` px below the top
 * of a rendered day track, snapped to `snapMin` and clamped to the rendered
 * `[startHour, endHour]` window.
 *
 * The create affordance and the drag/drop handlers share it, so a click at
 * 10:07 lands on exactly the slot a drop at 10:07 would (owner 2026-09-26:
 * "I need there to be more precision as to the time events can be
 * click-created into").
 */
export function snapTrackMinutes(
  offsetY: number,
  startHour: number,
  endHour: number,
  pxPerHour: number,
  snapMin: number,
): number {
  const start = startHour * 60;
  const raw = start + (offsetY / pxPerHour) * 60;
  const snapped = Math.round(raw / snapMin) * snapMin;
  return Math.min(endHour * 60, Math.max(start, snapped));
}
