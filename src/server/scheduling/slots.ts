/**
 * Pure slot-computation engine — a faithful port of cal.diy's availability→slots
 * logic, adapted to the hub's data shapes. No DB, no IO: given a resource's
 * availability, its existing bookings, and an event type's knobs, it returns the
 * bookable slots in a date range. This is the heart of the scheduling module and
 * is exhaustively unit-tested (see slots.test.ts).
 *
 * Pipeline (mirrors §3 of the design spec):
 *   1. Clamp the search window by minimum-booking-notice + the rolling period.
 *   2. Expand each resource's weekly availability (and single-date overrides)
 *      across the window, in the resource's own timezone, into UTC free intervals.
 *   3. Subtract existing bookings padded by before/after buffers.
 *   4. Slice free intervals into `length`-minute slots stepping by
 *      `slotInterval ?? length`.
 *   5. Combine across resources: round-robin/single → union (slot free if ANY
 *      resource is free, tagged with who); collective → intersect (all free).
 */

import { zonedTimeToUtc, parseHmToMinutes, dateKeyDayOfWeek, zonedDateKey } from './tz';

export interface AvailabilityRule {
  /** Days of week this rule applies to (0=Sun..6=Sat). Ignored when `date` set. */
  days: number[];
  startTime: string; // 'HH:MM' wall-clock in the resource timezone
  endTime: string; // 'HH:MM'
  /** Single-date override 'YYYY-MM-DD'; null = weekly recurring. */
  date: string | null;
}

export interface ResourceAvailability {
  resourceId: string;
  timezone: string;
  rules: AvailabilityRule[];
}

export interface BusyInterval {
  resourceId: string;
  start: Date;
  end: Date;
}

export interface SlotEventType {
  length: number; // minutes
  slotInterval?: number | null;
  beforeBuffer?: number; // minutes
  afterBuffer?: number; // minutes
  minimumBookingNotice?: number; // minutes
  periodType?: 'rolling' | 'unlimited';
  periodDays?: number | null;
  schedulingType?: 'round_robin' | 'collective' | null;
}

export interface ComputeSlotsInput {
  eventType: SlotEventType;
  resources: ResourceAvailability[];
  bookings: BusyInterval[];
  /** Inclusive UTC start of the range the caller wants slots for. */
  rangeStart: Date;
  /** Exclusive UTC end of the range. */
  rangeEnd: Date;
  /** "Now" — for minimum-booking-notice + rolling-period math. */
  now: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  /** Resources free for this slot (≥1; round-robin picks one at booking time). */
  resourceIds: string[];
}

interface Interval {
  start: number; // ms
  end: number; // ms
}

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** Enumerate 'YYYY-MM-DD' keys from startKey to endKey inclusive (UTC date math). */
function dateKeysBetween(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let t = Date.parse(`${startKey}T00:00:00Z`);
  const end = Date.parse(`${endKey}T00:00:00Z`);
  while (t <= end) {
    keys.push(new Date(t).toISOString().slice(0, 10));
    t += MS_PER_DAY;
  }
  return keys;
}

/** Subtract `busy` intervals from `free` intervals (both in ms). */
function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
  let result = [...free];
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of result) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f); // no overlap
        continue;
      }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    result = next;
  }
  return result;
}

/** Working UTC intervals for one resource on one local calendar date. */
function intervalsForDate(res: ResourceAvailability, dateKey: string): Interval[] {
  const overrides = res.rules.filter((r) => r.date === dateKey);
  // An override replaces that date's weekly hours entirely (cal.diy semantics).
  const applicable = overrides.length
    ? overrides
    : res.rules.filter((r) => r.date == null && r.days.includes(dateKeyDayOfWeek(dateKey)));

  const out: Interval[] = [];
  const [y, mo, d] = dateKey.split('-').map(Number);
  for (const rule of applicable) {
    const startMin = parseHmToMinutes(rule.startTime);
    const endMin = parseHmToMinutes(rule.endTime);
    if (endMin <= startMin) continue; // day off / empty range
    const start = zonedTimeToUtc(res.timezone, y, mo, d, Math.floor(startMin / 60), startMin % 60).getTime();
    const end = zonedTimeToUtc(res.timezone, y, mo, d, Math.floor(endMin / 60), endMin % 60).getTime();
    out.push({ start, end });
  }
  return mergeIntervals(out);
}

/** Merge overlapping/adjacent intervals (sorted by start). */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length < 2) return intervals;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else merged.push(sorted[i]);
  }
  return merged;
}

/** Slice a free interval into length-minute slots stepping by `step` minutes. */
function sliceSlots(interval: Interval, lengthMin: number, stepMin: number, windowStart: number): number[] {
  const starts: number[] = [];
  const lengthMs = lengthMin * MS_PER_MIN;
  const stepMs = stepMin * MS_PER_MIN;
  let s = interval.start;
  // Don't emit slots that would start before the allowed window.
  if (s < windowStart) {
    const stepsToSkip = Math.ceil((windowStart - s) / stepMs);
    s += stepsToSkip * stepMs;
  }
  while (s + lengthMs <= interval.end) {
    starts.push(s);
    s += stepMs;
  }
  return starts;
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { eventType, resources, bookings, rangeStart, rangeEnd, now } = input;
  const length = eventType.length;
  const step = eventType.slotInterval && eventType.slotInterval > 0 ? eventType.slotInterval : length;
  const beforeBuffer = eventType.beforeBuffer ?? 0;
  const afterBuffer = eventType.afterBuffer ?? 0;
  const notice = eventType.minimumBookingNotice ?? 0;

  // 1. Effective window.
  const windowStart = Math.max(rangeStart.getTime(), now.getTime() + notice * MS_PER_MIN);
  let windowEnd = rangeEnd.getTime();
  if (eventType.periodType !== 'unlimited' && eventType.periodDays && eventType.periodDays > 0) {
    windowEnd = Math.min(windowEnd, now.getTime() + eventType.periodDays * MS_PER_DAY);
  }
  if (windowStart >= windowEnd) return [];

  // 2-4. Per-resource slot starts.
  const perResource = new Map<string, Set<number>>();
  for (const res of resources) {
    // Local date span (pad ±1 day so a slot near a tz boundary isn't missed).
    const startKey = zonedDateKey(new Date(windowStart - MS_PER_DAY), res.timezone);
    const endKey = zonedDateKey(new Date(windowEnd + MS_PER_DAY), res.timezone);

    let free: Interval[] = [];
    for (const dateKey of dateKeysBetween(startKey, endKey)) {
      free.push(...intervalsForDate(res, dateKey));
    }
    free = mergeIntervals(free);

    // Subtract this resource's bookings, padded by buffers.
    const busy: Interval[] = bookings
      .filter((b) => b.resourceId === res.resourceId)
      .map((b) => ({
        start: b.start.getTime() - beforeBuffer * MS_PER_MIN,
        end: b.end.getTime() + afterBuffer * MS_PER_MIN,
      }));
    free = subtractIntervals(free, busy);

    const starts = new Set<number>();
    for (const interval of free) {
      // Clamp interval to the window before slicing.
      const clamped: Interval = {
        start: Math.max(interval.start, windowStart),
        end: Math.min(interval.end, windowEnd),
      };
      if (clamped.end - clamped.start < length * MS_PER_MIN) continue;
      for (const s of sliceSlots(interval, length, step, windowStart)) {
        if (s >= windowStart && s + length * MS_PER_MIN <= windowEnd) starts.add(s);
      }
    }
    perResource.set(res.resourceId, starts);
  }

  // 5. Combine across resources.
  const lengthMs = length * MS_PER_MIN;
  const collective = eventType.schedulingType === 'collective' && resources.length > 1;
  const byStart = new Map<number, string[]>();
  for (const [resourceId, starts] of perResource) {
    for (const s of starts) {
      const list = byStart.get(s) ?? [];
      list.push(resourceId);
      byStart.set(s, list);
    }
  }

  const slots: Slot[] = [];
  for (const [start, resourceIds] of byStart) {
    if (collective && resourceIds.length !== resources.length) continue;
    slots.push({ start: new Date(start), end: new Date(start + lengthMs), resourceIds });
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
