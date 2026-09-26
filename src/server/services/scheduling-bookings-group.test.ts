import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Same mock style as scheduling-bookings-reschedule.test.ts: isolate the service
// from the slot engine and the side-effect hooks it never reaches on a time-only
// change.
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import {
  groupBookingWith,
  moveGroup,
  ungroupBooking,
  planGroupMerge,
  planGroupSeparate,
  BookingConflictError,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const at = (h: number, m = 0) =>
  new Date(`2026-09-25T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
const iso = (h: number, m = 0) => at(h, m).toISOString();

/** A row as the group queries select it. */
const member = (
  id: string,
  from: Date,
  to: Date,
  metadata: Record<string, unknown> | null = null,
) => ({
  id,
  orgId: 'org-1',
  status: 'accepted',
  eventTypeId: 'et-1',
  resourceId: 'staff-1',
  startTime: from,
  endTime: to,
  metadata,
  title: 'Botox',
  partyId: 'p1',
  crmContactId: null,
  attendeeName: 'Ana',
});

/**
 * The mock db's chains are throwaway proxies, so a `.set()` payload is invisible
 * through the `db.update` spy alone — wrap the cached spy once and record every
 * payload in write order. This is how the tests see the window and the stamps
 * that actually reach the row.
 */
function captureUpdates(db: unknown) {
  const sets: Record<string, unknown>[] = [];
  const target = db as Record<string, unknown>;
  const inner = target['update'] as (...a: unknown[]) => Record<string, unknown>;
  target['update'] = vi.fn((...args: unknown[]) => {
    const chain = inner(...args);
    return new Proxy(chain, {
      get(t, prop) {
        if (prop === 'set')
          return (v: Record<string, unknown>) => {
            sets.push(v);
            return (t['set'] as (x: unknown) => unknown)(v);
          };
        return t[prop as string];
      },
    });
  });
  return sets;
}

/** The `{groupId,groupSeq,groupLength}` object merged into `metadata` by a write,
 *  or null when the write STRIPPED the group keys instead (the row left the
 *  visit). Drizzle keeps an interpolated string as a plain chunk between its
 *  `StringChunk`s, so the stamp is readable straight off `queryChunks`. */
function stampOf(set: Record<string, unknown>): Record<string, unknown> | null {
  const chunks = (set.metadata as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  for (const c of chunks) {
    if (typeof c === 'string' && c.startsWith('{')) {
      try {
        return JSON.parse(c) as Record<string, unknown>;
      } catch {
        // not the stamp chunk
      }
    }
  }
  return null;
}

describe('planGroupMerge', () => {
  it('merges into an UNGROUPED target: window grows by the moved duration, seqs 0/1', () => {
    const target = member('t', at(15), at(15, 30));
    const moved = member('m', at(17), at(17, 20));

    const { window, stamps } = planGroupMerge([target], moved);

    expect(window.start).toEqual(at(15));
    expect(window.end).toEqual(at(15, 50)); // target.end + 20min
    expect(stamps).toEqual([
      { id: 't', seq: 0, length: 30 },
      { id: 'm', seq: 1, length: 20 },
    ]);
  });

  it('merges into an EXISTING group: seq = max+1, window end grows, stamps kept', () => {
    const members = [
      member('a', at(15), at(15, 50), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(15, 50), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
    ];
    const moved = member('c', at(9), at(9, 15));

    const { window, stamps } = planGroupMerge(members, moved);

    expect(window.start).toEqual(at(15));
    expect(window.end).toEqual(at(16, 5)); // 15:50 + 15min
    expect(stamps).toEqual([
      { id: 'a', seq: 0, length: 30 },
      { id: 'b', seq: 1, length: 20 },
      { id: 'c', seq: 2, length: 15 },
    ]);
  });

  it('stamps a LEGACY back-to-back group from each row own duration', () => {
    const members = [
      member('a', at(15), at(15, 30), { groupId: 'g1' }),
      member('b', at(15, 30), at(16), { groupId: 'g1' }),
    ];

    const { window, stamps } = planGroupMerge(members, member('c', at(9), at(9, 10)));

    expect(window).toEqual({ start: at(15), end: at(16, 10) });
    expect(stamps).toEqual([
      { id: 'a', seq: 0, length: 30 },
      { id: 'b', seq: 1, length: 30 },
      { id: 'c', seq: 2, length: 10 },
    ]);
  });
});

describe('planGroupSeparate', () => {
  it('2 members: DESTROYS the container, restoring original durations from the window start', () => {
    const members = [
      member('a', at(15), at(16, 30), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(16, 30), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
    ];

    const plan = planGroupSeparate(members, 'b');

    expect(plan.destroyed).toBe(true);
    // Both leave (seq null) and are laid out back-to-back from 15:00 with their
    // OWN lengths — the container's 90 minutes are forgotten.
    expect(plan.rows).toEqual([
      { id: 'a', start: at(15), end: at(15, 30), seq: null },
      { id: 'b', start: at(15, 30), end: at(15, 50), seq: null },
    ]);
  });

  it('3 members: detaches at the window END and re-seqs the rest, container unchanged', () => {
    const members = [
      member('a', at(15), at(16), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(16), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
      member('c', at(15), at(16), { groupId: 'g1', groupSeq: 2, groupLength: 15 }),
    ];

    const plan = planGroupSeparate(members, 'b');

    expect(plan.destroyed).toBe(false);
    expect(plan.rows).toEqual([
      { id: 'b', start: at(16), end: at(16, 20), seq: null },
      { id: 'a', start: at(15), end: at(16), seq: 0 },
      { id: 'c', start: at(15), end: at(16), seq: 1 },
    ]);
  });

  it('falls back to a legacy row own duration when groupLength is missing', () => {
    const members = [
      member('a', at(15), at(15, 45), { groupId: 'g1' }),
      member('b', at(15, 45), at(16), { groupId: 'g1' }),
    ];

    const plan = planGroupSeparate(members, 'a');

    expect(plan.rows).toEqual([
      { id: 'a', start: at(15), end: at(15, 45), seq: null },
      { id: 'b', start: at(15, 45), end: at(16), seq: null },
    ]);
  });
});

describe('groupBookingWith', () => {
  it('writes the shared window + stamps to every member', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [member('m', at(17), at(17, 20)), member('t', at(15), at(15, 30))], // locked pair
      [{ beforeBuffer: 0, afterBuffer: 0 }], // conflict check: buffers
      [], // conflict check: other bookings on the resource
    ]);

    const { groupId } = await groupBookingWith(ctx(db), 'm', 't');

    expect(groupId).toMatch(/[0-9a-f-]{36}/);
    expect(sets).toHaveLength(2);
    for (const s of sets) {
      expect(s.startTime).toEqual(at(15));
      expect(s.endTime).toEqual(at(15, 50));
    }
    expect(stampOf(sets[0])).toEqual({ groupId, groupSeq: 0, groupLength: 30 });
    expect(stampOf(sets[1])).toEqual({ groupId, groupSeq: 1, groupLength: 20 });
  });

  it('checks the WHOLE window once and 409s on a non-member clash', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [member('m', at(17), at(17, 20)), member('t', at(15), at(15, 30))],
      [{ beforeBuffer: 0, afterBuffer: 0 }],
      // 15:40–16:00 clashes with the GROWN window (15:00–15:50), not with the
      // target alone — the one check is what catches it.
      [{ id: 'x', start: at(15, 40), end: at(16), title: 'Manicure', metadata: null }],
    ]);

    const err = await groupBookingWith(ctx(db), 'm', 't').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BookingConflictError);
    expect((err as BookingConflictError).conflicts.map((c) => c.id)).toEqual(['x']);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it('merges past a non-member clash with overrideConflicts', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [member('m', at(17), at(17, 20)), member('t', at(15), at(15, 30))],
      [{ beforeBuffer: 0, afterBuffer: 0 }],
      [{ id: 'x', start: at(15, 40), end: at(16), title: 'Manicure', metadata: null }],
    ]);

    await groupBookingWith(ctx(db), 'm', 't', { overrideConflicts: true });

    expect(sets).toHaveLength(2);
  });
});

describe('moveGroup', () => {
  const stamped = [
    member('a', at(15), at(16), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
    member('b', at(15), at(16), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
    member('c', at(15), at(16), { groupId: 'g1', groupSeq: 2, groupLength: 15 }),
  ];

  it('sets EVERY member to the window (and resource) after ONE conflict check', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      stamped, // members, locked
      [{ id: 'staff-2' }], // target resource is active
      [{ beforeBuffer: 0, afterBuffer: 0 }], // buffers
      [], // other bookings
    ]);

    const { moved } = await moveGroup(ctx(db), 'g1', {
      start: at(18),
      end: at(19, 30),
      resourceId: 'staff-2',
    });

    expect(moved).toBe(3);
    // 4 selects total: members, resource, buffers, neighbours. Three sequential
    // reschedules would have issued nine and re-rendered the box between each.
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(4);
    expect(sets).toHaveLength(3);
    for (const s of sets) {
      expect(s.startTime).toEqual(at(18));
      expect(s.endTime).toEqual(at(19, 30));
      expect(s.resourceId).toBe('staff-2');
    }
    // Stamps survive a move: the window is free, the members' own lengths are not.
    expect(sets.map((s) => stampOf(s))).toEqual([
      { groupId: 'g1', groupSeq: 0, groupLength: 30 },
      { groupId: 'g1', groupSeq: 1, groupLength: 20 },
      { groupId: 'g1', groupSeq: 2, groupLength: 15 },
    ]);
  });

  it('409s on a clash, and lands the move with overrideConflicts', async () => {
    const clash = [{ id: 'x', start: at(18), end: at(19), title: 'Other', metadata: null }];
    const seq = () => [stamped, [{ beforeBuffer: 0, afterBuffer: 0 }], clash];

    const blocked = createMockDb();
    blocked.resolveSequence(seq());
    const err = await moveGroup(ctx(blocked.db), 'g1', { start: at(18), end: at(19, 30) }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BookingConflictError);
    expect((err as BookingConflictError).conflicts.map((c) => c.id)).toEqual(['x']);
    expect(vi.mocked(blocked.db.update)).not.toHaveBeenCalled();

    const forced = createMockDb();
    forced.resolveSequence(seq());
    const out = await moveGroup(ctx(forced.db), 'g1', {
      start: at(18),
      end: at(19, 30),
      overrideConflicts: true,
    });
    expect(out.moved).toBe(3);
  });

  it('normalises a LEGACY group: pre-move durations become the stamps', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [
        member('a', at(15), at(15, 30), { groupId: 'g1' }),
        member('b', at(15, 30), at(16), { groupId: 'g1' }),
      ],
      [{ beforeBuffer: 0, afterBuffer: 0 }],
      [],
    ]);

    await moveGroup(ctx(db), 'g1', { start: at(18), end: at(18, 40) });

    // Read BEFORE the write, so the shared window never becomes a member's
    // "original" length — otherwise separating later would restore 40 min each.
    expect(sets.map((s) => stampOf(s))).toEqual([
      { groupId: 'g1', groupSeq: 0, groupLength: 30 },
      { groupId: 'g1', groupSeq: 1, groupLength: 30 },
    ]);
  });

  it('refuses a degenerate window before touching the db', async () => {
    const { db } = createMockDb();
    await expect(moveGroup(ctx(db), 'g1', { start: at(18), end: at(18) })).rejects.toThrow(
      'end must be after start',
    );
    await expect(moveGroup(ctx(db), 'g1', { start: at(18), end: at(18, 3) })).rejects.toThrow(
      /at least 5 minutes/,
    );
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });
});

describe('ungroupBooking', () => {
  it('with 2 members destroys the container and restores both durations', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    const members = [
      member('a', at(15), at(16, 30), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(16, 30), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
    ];
    resolveSequence([
      [members[1]], // the row being separated
      members, // members, locked
      [{ beforeBuffer: 0, afterBuffer: 0 }], // a's restored placement: buffers
      [], // a: neighbours
      [{ beforeBuffer: 0, afterBuffer: 0 }], // b: buffers
      [], // b: neighbours
    ]);

    const { destroyed } = await ungroupBooking(ctx(db), 'b');

    expect(destroyed).toBe(true);
    expect(sets).toHaveLength(2);
    expect(sets[0].startTime).toEqual(at(15));
    expect(sets[0].endTime).toEqual(at(15, 30));
    expect(sets[1].startTime).toEqual(at(15, 30));
    expect(sets[1].endTime).toEqual(at(15, 50));
    // Every group key gone from both rows — no one-member container survives.
    expect(sets.map((s) => stampOf(s))).toEqual([null, null]);
  });

  it('with 3 members detaches at the window end and re-seqs the rest', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    const members = [
      member('a', at(15), at(16), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(16), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
      member('c', at(15), at(16), { groupId: 'g1', groupSeq: 2, groupLength: 15 }),
    ];
    resolveSequence([
      [members[1]],
      members,
      [{ beforeBuffer: 0, afterBuffer: 0 }], // only the DETACHED row can clash
      [],
    ]);

    const { destroyed } = await ungroupBooking(ctx(db), 'b');

    expect(destroyed).toBe(false);
    expect(sets).toHaveLength(3);
    expect(sets[0].startTime).toEqual(at(16));
    expect(sets[0].endTime).toEqual(at(16, 20));
    expect(stampOf(sets[0])).toBeNull();
    // The container keeps its window; the survivors are re-seqed 0..n-1.
    expect(sets.slice(1).map((s) => [s.startTime, s.endTime])).toEqual([
      [at(15), at(16)],
      [at(15), at(16)],
    ]);
    expect(sets.slice(1).map((s) => stampOf(s))).toEqual([
      { groupId: 'g1', groupSeq: 0, groupLength: 30 },
      { groupId: 'g1', groupSeq: 1, groupLength: 15 },
    ]);
  });

  it('409s when the restored placement clashes, and lands it with overrideConflicts', async () => {
    const members = [
      member('a', at(15), at(16), { groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      member('b', at(15), at(16), { groupId: 'g1', groupSeq: 1, groupLength: 20 }),
      member('c', at(15), at(16), { groupId: 'g1', groupSeq: 2, groupLength: 15 }),
    ];
    const seq = () => [
      [members[1]],
      members,
      [{ beforeBuffer: 0, afterBuffer: 0 }],
      // 16:10–16:30 lands on the detached row's restored 16:00–16:20.
      [{ id: 'x', start: at(16, 10), end: at(16, 30), title: 'Other', metadata: null }],
    ];

    const blocked = createMockDb();
    blocked.resolveSequence(seq());
    const err = await ungroupBooking(ctx(blocked.db), 'b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookingConflictError);
    expect((err as BookingConflictError).conflicts.map((c) => c.id)).toEqual(['x']);
    expect(vi.mocked(blocked.db.update)).not.toHaveBeenCalled();

    const forced = createMockDb();
    forced.resolveSequence(seq());
    await expect(ungroupBooking(ctx(forced.db), 'b', { overrideConflicts: true })).resolves.toEqual(
      { destroyed: false },
    );
  });

  it('is a no-op strip on an already ungrouped booking (no conflict queries)', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([[member('a', at(15), at(15, 30))]]);

    const out = await ungroupBooking(ctx(db), 'a');

    expect(out).toEqual({ destroyed: false });
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
    expect(sets).toHaveLength(1);
    expect(sets[0].startTime).toBeUndefined();
    expect(stampOf(sets[0])).toBeNull();
  });
});
