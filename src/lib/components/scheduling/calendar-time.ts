import {
  checkedZonedDayWindow,
  offsetMinutesAt,
  resolveWallTime,
  type WallTimeResolution,
  type ZonedDayWindowResult,
} from '$lib/time/zoned';

export type CalendarTimeFailure = Extract<WallTimeResolution, { ok: false }>;

export type CalendarInstantResult = { ok: true; instant: Date } | CalendarTimeFailure;

export type CalendarMutationResult = { ok: true; start: string; end: string } | CalendarTimeFailure;

function wallParts(date: string, minutes: number) {
  return {
    date,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  };
}

/** Resolve one organization wall slot, optionally retaining a source fold offset. */
export function resolveCalendarInstant(
  date: string,
  minutes: number,
  timeZone: string,
  preferredInstant?: Date | string,
): CalendarInstantResult {
  let preferredOffsetMinutes: number | undefined;
  if (preferredInstant !== undefined) {
    const source = preferredInstant instanceof Date ? preferredInstant : new Date(preferredInstant);
    if (Number.isNaN(source.getTime())) {
      return { ok: false, kind: 'invalid', reason: 'invalid preferred instant' };
    }
    try {
      preferredOffsetMinutes = offsetMinutesAt(source, timeZone);
    } catch {
      return { ok: false, kind: 'invalid', reason: 'invalid timezone' };
    }
  }
  const resolved = resolveWallTime(wallParts(date, minutes), timeZone, {
    preferredOffsetMinutes,
  });
  return resolved.ok ? { ok: true, instant: resolved.instant } : resolved;
}

/**
 * Convert a drag ghost into an absolute booking window.
 *
 * A move resolves the new start and adds the original absolute duration. A
 * resize resolves both wall endpoints and rejects an end that is not later.
 */
export function resolveCalendarMutation(input: {
  mode: 'move' | 'resize';
  date: string;
  startMinutes: number;
  endMinutes: number;
  timeZone: string;
  sourceStart: string;
  sourceEnd: string;
}): CalendarMutationResult {
  const sourceStart = new Date(input.sourceStart);
  const sourceEnd = new Date(input.sourceEnd);
  if (
    Number.isNaN(sourceStart.getTime()) ||
    Number.isNaN(sourceEnd.getTime()) ||
    sourceEnd <= sourceStart
  ) {
    return { ok: false, kind: 'invalid', reason: 'invalid source window' };
  }

  const start = resolveCalendarInstant(input.date, input.startMinutes, input.timeZone, sourceStart);
  if (!start.ok) return start;

  if (input.mode === 'move') {
    const duration = sourceEnd.getTime() - sourceStart.getTime();
    return {
      ok: true,
      start: start.instant.toISOString(),
      end: new Date(start.instant.getTime() + duration).toISOString(),
    };
  }

  const end = resolveCalendarInstant(input.date, input.endMinutes, input.timeZone, sourceEnd);
  if (!end.ok) return end;
  if (end.instant <= start.instant) {
    return { ok: false, kind: 'invalid', reason: 'end must be after start' };
  }
  return { ok: true, start: start.instant.toISOString(), end: end.instant.toISOString() };
}

/** Selected organization dates as a half-open slot-query window. */
export function schedulingSlotWindow(day: string, timeZone: string): ZonedDayWindowResult {
  return checkedZonedDayWindow(day, day, timeZone);
}
