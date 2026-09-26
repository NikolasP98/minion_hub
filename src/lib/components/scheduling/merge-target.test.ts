import { describe, expect, it } from 'vitest';
import { groupBookings } from './booking-groups';
import { mergeTargetBox } from './merge-target';
import type { CalendarBooking } from './calendar-window';

/** Minutes from midnight in the same browser-local way the grid reads them. */
const minutesOf = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const at = (h: number, min = 0) =>
  `2026-09-25T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;

const booking = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
  resourceId: 'r1',
  eventTypeId: 'e1',
  start: at(9),
  end: at(10),
  status: 'accepted',
  partyId: 'p1',
  attendeeName: 'Ana',
  ...over,
});

const dragged = booking({ id: 'drag', start: at(14), end: at(15) });
const host = booking({ id: 'host' }); // 09:00–10:00, same client + chair
const boxes = groupBookings([host, dragged]);
const box = (id: string) => boxes.find((b) => b.key === id)!;

const target = (startMin: number, over: Partial<Parameters<typeof mergeTargetBox>[0]> = {}) =>
  mergeTargetBox({
    boxes,
    dragged: box('drag'),
    startMin,
    endMin: startMin + 60,
    resourceId: 'r1',
    minutesOf,
    ...over,
  });

// TODO(handoff): the PREDICATE is covered here, the WIRING is not — no test
// asserts that the `is-merge-target` class, the ghost's `cal_merge_hint` label
// and the drop's `mergeAsk` all read this one value, nor that a container drop
// makes exactly ONE `onmove(lead, …, { group: true })` call with the optimistic
// overlay written first. `BookingCalendar.svelte` has no component-test harness
// in this repo (every scheduling test is a pure module), so that needs a
// vitest-browser/testing-library setup decision. Ledger:
// proposals/2026-09-25-hub-pos-calendar-color-followups.md.
describe('mergeTargetBox', () => {
  it('finds the box whose span intersects the ghost', () => {
    expect(target(9 * 60 + 30)?.key).toBe('host');
    expect(target(9 * 60)?.key).toBe('host');
    expect(target(8 * 60 + 1)?.key).toBe('host'); // 08:01–09:01 overlaps by a minute
  });

  it('ignores a ghost that only touches or misses the span', () => {
    expect(target(8 * 60)).toBeNull(); // 08:00–09:00 ends where host starts
    expect(target(10 * 60)).toBeNull(); // end is exclusive — back-to-back is a move
  });

  it('never targets the dragged box itself', () => {
    expect(target(14 * 60 + 30)).toBeNull();
  });

  it('refuses another resource, another client and an unknown client', () => {
    expect(target(9 * 60 + 30, { resourceId: 'r2' })).toBeNull();
    const other = groupBookings([booking({ id: 'host', partyId: 'p2' }), dragged]);
    expect(
      mergeTargetBox({
        boxes: other,
        dragged: other.find((b) => b.key === 'drag')!,
        startMin: 9 * 60 + 30,
        endMin: 10 * 60 + 30,
        resourceId: 'r1',
        minutesOf,
      }),
    ).toBeNull();
  });

  it('refuses to merge a whole container into another box', () => {
    const visit = groupBookings([
      booking({ id: 'm0', start: at(14), end: at(15), groupId: 'g1', groupSeq: 0 }),
      booking({ id: 'm1', start: at(14), end: at(15), groupId: 'g1', groupSeq: 1 }),
      host,
    ]);
    expect(
      mergeTargetBox({
        boxes: visit,
        dragged: visit.find((b) => b.key === 'm0')!,
        startMin: 9 * 60 + 30,
        endMin: 10 * 60 + 30,
        resourceId: 'r1',
        minutesOf,
      }),
    ).toBeNull();
  });
});
