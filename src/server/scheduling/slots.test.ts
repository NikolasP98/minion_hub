import { describe, it, expect } from 'vitest';
import { computeSlots } from './slots';
import type { ResourceAvailability, BusyInterval, SlotEventType } from './slots';

const LIMA = 'America/Lima'; // UTC-5, no DST

/** A resource with Mon–Fri 09:00–17:00 in Lima. */
function weekday9to5(resourceId = 'r1', tz = LIMA): ResourceAvailability {
  return {
    resourceId,
    timezone: tz,
    rules: [{ days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', date: null }],
  };
}

const iso = (s: string) => new Date(s);
const isos = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString());

describe('computeSlots', () => {
  it('slices a single weekday into back-to-back slots', () => {
    // Sat 2026-06-20 is not a work day; Mon 2026-06-22 is. Range covers Monday.
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    // 09:00–17:00 Lima == 14:00–22:00 UTC → 8 one-hour slots.
    expect(slots).toHaveLength(8);
    expect(slots[0].start.toISOString()).toBe('2026-06-22T14:00:00.000Z');
    expect(slots[7].start.toISOString()).toBe('2026-06-22T21:00:00.000Z');
    expect(slots[7].end.toISOString()).toBe('2026-06-22T22:00:00.000Z');
  });

  it('does not produce slots on a non-working day', () => {
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-21T00:00:00Z'), // Sunday
      rangeEnd: iso('2026-06-22T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(0);
  });

  it('uses slotInterval to step independently of length', () => {
    const slots = computeSlots({
      eventType: { length: 60, slotInterval: 30 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    // 8h window, 60-min slots stepping 30 → starts at :00 and :30 until last fit
    // (last start 16:00 Lima = 21:00 UTC). 09:00..16:00 stepping 30 = 15 starts.
    expect(slots).toHaveLength(15);
    expect(isos(slots).slice(0, 3)).toEqual([
      '2026-06-22T14:00:00.000Z',
      '2026-06-22T14:30:00.000Z',
      '2026-06-22T15:00:00.000Z',
    ]);
  });

  it('subtracts an existing booking', () => {
    const bookings: BusyInterval[] = [
      { resourceId: 'r1', start: iso('2026-06-22T15:00:00Z'), end: iso('2026-06-22T16:00:00Z') },
    ];
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings,
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    // The 15:00–16:00 UTC slot is gone → 7 left.
    expect(slots).toHaveLength(7);
    expect(isos(slots)).not.toContain('2026-06-22T15:00:00.000Z');
  });

  it('pads bookings with before/after buffers', () => {
    const bookings: BusyInterval[] = [
      { resourceId: 'r1', start: iso('2026-06-22T16:00:00Z'), end: iso('2026-06-22T17:00:00Z') },
    ];
    const slots = computeSlots({
      eventType: { length: 60, beforeBuffer: 15, afterBuffer: 15 },
      resources: [weekday9to5()],
      bookings,
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    // Booking 16:00–17:00 padded to 15:45–17:15 removes the 15:00 (ends 16:00 >15:45? overlaps)
    // and 17:00 slots; the 15:00 slot (15:00–16:00) overlaps the 15:45 pad → removed too.
    expect(isos(slots)).not.toContain('2026-06-22T16:00:00.000Z');
    expect(isos(slots)).not.toContain('2026-06-22T15:00:00.000Z');
  });

  it('honors minimum booking notice', () => {
    // now = Mon 09:30 Lima (14:30 UTC); 120-min notice → first bookable 16:30 UTC.
    const slots = computeSlots({
      eventType: { length: 60, minimumBookingNotice: 120 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-22T14:30:00Z'),
    });
    // Earliest slot start must be >= 16:30 UTC; with hourly grid that's 17:00.
    expect(slots[0].start.toISOString()).toBe('2026-06-22T17:00:00.000Z');
  });

  it('honors a rolling period window', () => {
    const slots = computeSlots({
      eventType: { length: 60, periodType: 'rolling', periodDays: 1 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-30T00:00:00Z'),
      now: iso('2026-06-22T00:00:00Z'),
    });
    // Only ~24h ahead bookable → all slots within Jun 22–23.
    expect(slots.every((s) => s.start.getTime() <= iso('2026-06-23T00:00:00Z').getTime())).toBe(true);
  });

  it('applies a single-date override over the weekly rule', () => {
    const res: ResourceAvailability = {
      resourceId: 'r1',
      timezone: LIMA,
      rules: [
        { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', date: null },
        // Override Monday Jun 22 to a short morning only.
        { days: [], startTime: '09:00', endTime: '11:00', date: '2026-06-22' },
      ],
    };
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [res],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    // 09:00–11:00 Lima == 14:00–16:00 UTC → 2 slots.
    expect(slots).toHaveLength(2);
    expect(isos(slots)).toEqual(['2026-06-22T14:00:00.000Z', '2026-06-22T15:00:00.000Z']);
  });

  it('treats an empty-range override as a day off', () => {
    const res: ResourceAvailability = {
      resourceId: 'r1',
      timezone: LIMA,
      rules: [
        { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', date: null },
        { days: [], startTime: '00:00', endTime: '00:00', date: '2026-06-22' }, // off
      ],
    };
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [res],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(0);
  });

  it('round-robin: unions slots across staff and tags who is free', () => {
    const r1 = weekday9to5('r1');
    const r2 = weekday9to5('r2');
    const bookings: BusyInterval[] = [
      // r1 busy 15:00–16:00 UTC; r2 still free then.
      { resourceId: 'r1', start: iso('2026-06-22T15:00:00Z'), end: iso('2026-06-22T16:00:00Z') },
    ];
    const slots = computeSlots({
      eventType: { length: 60, schedulingType: 'round_robin' },
      resources: [r1, r2],
      bookings,
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(8); // union: 15:00 still offered (by r2)
    const at15 = slots.find((s) => s.start.toISOString() === '2026-06-22T15:00:00.000Z');
    expect(at15?.resourceIds).toEqual(['r2']);
    const at14 = slots.find((s) => s.start.toISOString() === '2026-06-22T14:00:00.000Z');
    expect(at14?.resourceIds.sort()).toEqual(['r1', 'r2']);
  });

  it('collective: only offers slots where ALL staff are free', () => {
    const r1 = weekday9to5('r1');
    const r2 = weekday9to5('r2');
    const bookings: BusyInterval[] = [
      { resourceId: 'r1', start: iso('2026-06-22T15:00:00Z'), end: iso('2026-06-22T16:00:00Z') },
    ];
    const slots = computeSlots({
      eventType: { length: 60, schedulingType: 'collective' },
      resources: [r1, r2],
      bookings,
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(7); // 15:00 excluded (r1 busy)
    expect(isos(slots)).not.toContain('2026-06-22T15:00:00.000Z');
    for (const s of slots) expect(s.resourceIds.sort()).toEqual(['r1', 'r2']);
  });

  it('returns nothing when the window is empty', () => {
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-22T00:00:00Z'), // zero-width
      now: iso('2026-06-01T00:00:00Z'),
    });
    expect(slots).toHaveLength(0);
  });

  it('serviceRules intersect with resource availability (morning-only service)', () => {
    // Resource free Mon 09:00–17:00 Lima; service offered only 09:00–12:00.
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'),
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
      serviceRules: [{ days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '12:00', date: null }],
    });
    // 09:00–12:00 Lima == 14:00–17:00 UTC → 3 one-hour slots.
    expect(isos(slots)).toEqual(['2026-06-22T14:00:00.000Z', '2026-06-22T15:00:00.000Z', '2026-06-22T16:00:00.000Z']);
  });

  it('serviceRules exclude a day the resource works', () => {
    // Service offered only Wed; the Monday range yields nothing.
    const slots = computeSlots({
      eventType: { length: 60 },
      resources: [weekday9to5()],
      bookings: [],
      rangeStart: iso('2026-06-22T00:00:00Z'), // Monday
      rangeEnd: iso('2026-06-23T00:00:00Z'),
      now: iso('2026-06-01T00:00:00Z'),
      serviceRules: [{ days: [3], startTime: '09:00', endTime: '17:00', date: null }],
    });
    expect(slots).toHaveLength(0);
  });
});
