import { describe, expect, it } from 'vitest';
import {
  canMergeBookings,
  clientKeyOf,
  groupBookings,
  inactiveMemberCount,
  isInactiveMemberStatus,
} from './booking-groups';
import type { CalendarBooking } from './calendar-window';

const at = (h: number, min = 0) =>
  `2026-09-25T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`;

const booking = (over: Partial<CalendarBooking> & { id: string }): CalendarBooking => ({
  resourceId: 'r1',
  eventTypeId: 'e1',
  start: at(9),
  end: at(10),
  status: 'accepted',
  attendeeName: 'Ana',
  ...over,
});

describe('clientKeyOf', () => {
  it('prefers the party id over the typed-in name', () => {
    expect(clientKeyOf({ partyId: 'p1', attendeeName: 'Ana' })).toBe('p:p1');
    expect(clientKeyOf({ partyId: null, attendeeName: ' Ana ' })).toBe('n:ana');
  });

  it('is null for an unknown client', () => {
    expect(clientKeyOf({ partyId: null, attendeeName: null })).toBeNull();
    expect(clientKeyOf({ partyId: null, attendeeName: '  ' })).toBeNull();
  });
});

describe('canMergeBookings', () => {
  const a = booking({ id: 'a', partyId: 'p1' });

  it('merges the same client on the same resource', () => {
    expect(canMergeBookings(a, booking({ id: 'b', partyId: 'p1' }))).toBe(true);
  });

  it('refuses a different resource, a different client, an unknown client and itself', () => {
    expect(canMergeBookings(a, booking({ id: 'b', partyId: 'p1', resourceId: 'r2' }))).toBe(false);
    expect(canMergeBookings(a, booking({ id: 'b', partyId: 'p2' }))).toBe(false);
    expect(canMergeBookings(booking({ id: 'a', attendeeName: null }), booking({ id: 'b' }))).toBe(
      false,
    );
    expect(canMergeBookings(a, a)).toBe(false);
  });
});

describe('groupBookings', () => {
  it('leaves ungrouped bookings as one box each, in start order', () => {
    const boxes = groupBookings([
      booking({ id: 'b', start: at(11), end: at(12) }),
      booking({ id: 'a', start: at(9), end: at(10) }),
    ]);
    expect(boxes.map((x) => x.key)).toEqual(['a', 'b']);
    expect(boxes.every((x) => x.members.length === 1)).toBe(true);
  });

  it('collapses same-group bookings into one box spanning first→last', () => {
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', start: at(9), end: at(9, 30) }),
      booking({ id: 'b', groupId: 'g1', start: at(9, 30), end: at(10, 15) }),
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].key).toBe('a');
    expect(boxes[0].members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(boxes[0].start).toBe(at(9));
    expect(boxes[0].end).toBe(at(10, 15));
  });

  it('never groups across resources, even with the same group id', () => {
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', start: at(9), end: at(9, 30) }),
      booking({ id: 'b', groupId: 'g1', resourceId: 'r2', start: at(9, 30), end: at(10) }),
    ]);
    expect(boxes.map((x) => x.members.length)).toEqual([1, 1]);
  });

  it('keeps a group whole even when a foreign booking sits inside its window', () => {
    // Container members share one window, so a booking overlapping it (or wedged
    // between two legacy back-to-back members) must not split the visit.
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', start: at(9), end: at(9, 30) }),
      booking({ id: 'x', start: at(9, 30), end: at(10) }),
      booking({ id: 'b', groupId: 'g1', start: at(10), end: at(10, 30) }),
    ]);
    expect(boxes.map((x) => x.members.map((m) => m.id))).toEqual([['a', 'b'], ['x']]);
    expect(boxes[0].start).toBe(at(9));
    expect(boxes[0].end).toBe(at(10, 30));
  });

  it('orders members by groupSeq, not by start, and leads with seq 0', () => {
    // A container's members all carry the SAME window, so only `groupSeq` says
    // which procedure opens the visit.
    const boxes = groupBookings([
      booking({ id: 'zz', groupId: 'g1', groupSeq: 0, start: at(9), end: at(10) }),
      booking({ id: 'aa', groupId: 'g1', groupSeq: 1, start: at(9), end: at(10) }),
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].members.map((m) => m.id)).toEqual(['zz', 'aa']);
    expect(boxes[0].lead.id).toBe('zz');
    expect(boxes[0].key).toBe('zz');
  });

  it('spans min(start)..max(end) over ALL members, in any input order', () => {
    const boxes = groupBookings([
      booking({ id: 'b', groupId: 'g1', groupSeq: 1, start: at(9, 30), end: at(11) }),
      booking({ id: 'a', groupId: 'g1', groupSeq: 0, start: at(9), end: at(9, 45) }),
    ]);
    expect(boxes[0].start).toBe(at(9));
    expect(boxes[0].end).toBe(at(11));
    expect(boxes[0].members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('keeps the box end at the latest member end even when a member is shorter', () => {
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', start: at(9), end: at(11) }),
      booking({ id: 'b', groupId: 'g1', start: at(9, 30), end: at(10) }),
    ]);
    expect(boxes[0].end).toBe(at(11));
  });

  describe('statusLead', () => {
    it('is the lead when no member is cancelled', () => {
      const boxes = groupBookings([
        booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'accepted' }),
        booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'accepted' }),
      ]);
      expect(boxes[0].statusLead.id).toBe('a');
    });

    it('skips a cancelled lead and follows the first active member instead', () => {
      const boxes = groupBookings([
        booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'cancelled' }),
        booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'accepted' }),
        booking({ id: 'c', groupId: 'g1', groupSeq: 2, status: 'accepted' }),
      ]);
      expect(boxes[0].lead.id).toBe('a');
      expect(boxes[0].statusLead.id).toBe('b');
    });

    it('skips rejected/no_show too, in groupSeq order', () => {
      const boxes = groupBookings([
        booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'rejected' }),
        booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'no_show' }),
        booking({ id: 'c', groupId: 'g1', groupSeq: 2, status: 'pending' }),
      ]);
      expect(boxes[0].statusLead.id).toBe('c');
    });

    it('falls back to the lead when every member is inactive', () => {
      const boxes = groupBookings([
        booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'cancelled' }),
        booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'no_show' }),
      ]);
      expect(boxes[0].statusLead.id).toBe('a');
    });

    it('is always the lead for a single booking', () => {
      const boxes = groupBookings([booking({ id: 'a', status: 'cancelled' })]);
      expect(boxes[0].statusLead.id).toBe('a');
    });
  });
});

describe('isInactiveMemberStatus', () => {
  it('is true only for cancelled/rejected/no_show', () => {
    expect(isInactiveMemberStatus('cancelled')).toBe(true);
    expect(isInactiveMemberStatus('rejected')).toBe(true);
    expect(isInactiveMemberStatus('no_show')).toBe(true);
    expect(isInactiveMemberStatus('accepted')).toBe(false);
    expect(isInactiveMemberStatus('completed')).toBe(false);
  });
});

describe('inactiveMemberCount', () => {
  it('counts cancelled/rejected/no_show members', () => {
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'cancelled' }),
      booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'accepted' }),
      booking({ id: 'c', groupId: 'g1', groupSeq: 2, status: 'no_show' }),
    ]);
    expect(inactiveMemberCount(boxes[0])).toBe(2);
  });

  it('is zero when every member is active', () => {
    const boxes = groupBookings([
      booking({ id: 'a', groupId: 'g1', groupSeq: 0, status: 'accepted' }),
      booking({ id: 'b', groupId: 'g1', groupSeq: 1, status: 'pending' }),
    ]);
    expect(inactiveMemberCount(boxes[0])).toBe(0);
  });
});
