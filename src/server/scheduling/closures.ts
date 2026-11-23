/**
 * Spec 147 "Cerrar agenda": turn one form submit (a local date range, all day or
 * a daily From–To window, and a reason) into one closure per local day. Pure, so
 * the rules are unit-tested without a database.
 */
import { dateKeyAddDays, parseDateKey, startOfZonedDate } from '$lib/time/zoned';
import { zonedTimeToUtc } from './tz';

export const CLOSURE_MAX_DAYS = 62;
export const CLOSURE_REASON_MAX = 120;

export interface ClosureInput {
  fromDate: string;
  toDate?: string | null;
  /** Both absent = all day. */
  startTime?: string | null;
  endTime?: string | null;
  reason: string;
}

export type ClosureDays =
  | { ok: true; reason: string; days: { startsAt: Date; endsAt: Date }[] }
  | { ok: false; error: string };

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function expandClosureDays(input: ClosureInput, timeZone: string): ClosureDays {
  const reason = (input.reason ?? '').trim();
  if (!reason) return { ok: false, error: 'reason is required' };
  if (reason.length > CLOSURE_REASON_MAX)
    return { ok: false, error: `reason must be at most ${CLOSURE_REASON_MAX} characters` };
  const from = input.fromDate;
  const to = input.toDate || from;
  if (!parseDateKey(from) || !parseDateKey(to)) return { ok: false, error: 'invalid date' };
  if (to < from) return { ok: false, error: 'toDate must not be before fromDate' };
  const allDay = !input.startTime && !input.endTime;
  const s = allDay ? null : HM.exec(input.startTime ?? '');
  const e = allDay ? null : HM.exec(input.endTime ?? '');
  if (!allDay && (!s || !e)) return { ok: false, error: 'startTime and endTime must be HH:MM' };
  if (s && e && e[0] <= s[0]) return { ok: false, error: 'endTime must be after startTime' };

  const days: { startsAt: Date; endsAt: Date }[] = [];
  for (let day: string | null = from; day && day <= to; day = dateKeyAddDays(day, 1)) {
    if (days.length >= CLOSURE_MAX_DAYS)
      return { ok: false, error: `a closure spans at most ${CLOSURE_MAX_DAYS} days` };
    if (allDay) {
      const start = startOfZonedDate(day, timeZone);
      const end = startOfZonedDate(dateKeyAddDays(day, 1)!, timeZone);
      if (!start.ok || !end.ok) return { ok: false, error: 'invalid date' };
      days.push({ startsAt: start.instant, endsAt: end.instant });
    } else {
      const p = parseDateKey(day)!;
      days.push({
        startsAt: zonedTimeToUtc(timeZone, p.year, p.month, p.day, +s![1], +s![2]),
        endsAt: zonedTimeToUtc(timeZone, p.year, p.month, p.day, +e![1], +e![2]),
      });
    }
  }
  return { ok: true, reason, days };
}
