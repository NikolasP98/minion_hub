/**
 * Calendar view/window arithmetic shared by `/scheduling/calendar` and
 * `/pos/appointments` (and by their `+page.server.ts` loads).
 *
 * All day math runs on `YYYY-MM-DD` strings through `Date.UTC`, so it is
 * timezone-free: the only place a real instant is produced is the server load,
 * which resolves the window with `zonedDayWindow(first, last, orgTz)` — a
 * half-open `[start of first day, start of the day AFTER the last)` window.
 * That is the inclusive-range contract for a TIMESTAMP column with day bounds:
 * the bound's type decides, so `<= to` (midnight) would drop the last day.
 */

import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';

export type CalendarView = 'day' | 'workweek' | 'week';

export const CALENDAR_VIEWS = ['day', 'workweek', 'week'] as const;

/** Front-desk default on both calendars (owner directive 2026-09-14). */
export const DEFAULT_CALENDAR_VIEW: CalendarView = 'workweek';

const DAY_MS = 86_400_000;

function toUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function toDayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isCalendarView(value: string | null): value is CalendarView {
  return value != null && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

export function parseCalendarView(value: string | null): CalendarView {
  return isCalendarView(value) ? value : DEFAULT_CALENDAR_VIEW;
}

/** `?date=` is only honoured when it is a real `YYYY-MM-DD`; else the fallback. */
export function parseCalendarDate(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

/** Monday of the ISO week containing `day`. */
function mondayOf(day: string): number {
  const ms = toUtcMs(day);
  const isoOffset = (new Date(ms).getUTCDay() + 6) % 7; // Sun=6, Mon=0
  return ms - isoOffset * DAY_MS;
}

/** The ordered `YYYY-MM-DD` columns a view renders for a focused date. */
export function calendarDays(day: string, view: CalendarView): string[] {
  if (view === 'day') return [day];
  const start = mondayOf(day);
  const span = view === 'workweek' ? 5 : 7;
  return Array.from({ length: span }, (_, i) => toDayString(start + i * DAY_MS));
}

/** Prev/next steps one day in day view and one whole week otherwise. */
export function shiftCalendarDate(day: string, view: CalendarView, delta: number): string {
  return toDayString(toUtcMs(day) + delta * (view === 'day' ? 1 : 7) * DAY_MS);
}

/** Today as a `YYYY-MM-DD` calendar date in `tz` (never `toISOString()`). */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** First of the month, `delta` months from `day`'s month (year rolls over). */
export function shiftCalendarMonth(day: string, delta: number): string {
  const [y, m] = day.split('-').map(Number);
  return toDayString(Date.UTC(y, (m ?? 1) - 1 + delta, 1));
}

/** Monday-first 42-cell (6 week) grid for the month containing `day` — the
 *  window the calendar date-picker renders, including the leading/trailing
 *  days of the adjacent months that fill out the first/last row. */
export function monthGridDays(day: string): string[] {
  const [y, m] = day.split('-').map(Number);
  const first = Date.UTC(y, (m ?? 1) - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // Sun=6, Mon=0
  const start = first - lead * DAY_MS;
  return Array.from({ length: 42 }, (_, i) => toDayString(start + i * DAY_MS));
}

/** The compact booking shape `BookingCalendar` renders. */
export interface CalendarBooking {
  id: string;
  resourceId: string;
  eventTypeId: string;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
  status: string;
  attendeeName: string | null;
  attendeePhone?: string | null;
  /** A follow-up that references a paid treatment (`metadata.followUpOf`). */
  checkup?: boolean;
}

/** A submitted POS ticket on the calendar — the money moment of a treatment. */
export interface CalendarInvoice {
  id: string;
  humanId: string | null;
  /** ISO instant the ticket was submitted (= paid). */
  at: string;
  total: number;
  currency: string;
  customerName: string | null;
  lines: { id: string; description: string; bookingId: string | null }[];
}

export interface CalendarResource {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * The instant window a view's data load must query, INCLUSIVE of both the first
 * and the last rendered day, resolved in the org's business timezone.
 *
 * `listBookings` compares `startTime` with `lte`, so the half-open upper bound
 * (`start of the day AFTER the last`) is handed over as the last instant before
 * it — a bare midnight `to` would drop every booking on the final column, and a
 * UTC day window would drop a 19:30 Lima appointment.
 */
export function calendarInstantWindow(
  day: string,
  view: CalendarView,
  tz: string,
): { days: string[]; from: Date; to: Date } {
  const days = calendarDays(day, view);
  const window = zonedDayWindow(days[0], days[days.length - 1], tz);
  return { days, from: window.from!, to: new Date(window.to!.getTime() - 1) };
}
