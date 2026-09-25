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
