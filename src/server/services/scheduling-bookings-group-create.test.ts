import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// Same mock style as scheduling-bookings-override.test.ts: the pure slot engine
// and the side-effect hooks are stubbed so the test is about what
// createBookingGroup WRITES, not about availability arithmetic.
const computeSlotsMock = vi.fn<(input: unknown) => Array<{ start: Date; resourceIds: string[] }>>(
  () => [],
);
vi.mock('$server/scheduling/slots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$server/scheduling/slots')>();
  return { ...actual, computeSlots: (input: unknown) => computeSlotsMock(input) };
});
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
const accrueMock = vi.fn(async () => 0);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => accrueMock(),
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import {
  createBookingGroup,
  SlotUnavailableError,
  BookingConflictError,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
  computeSlotsMock.mockReturnValue([]);
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const start = new Date('2026-09-28T15:00:00.000Z');
const at = (min: number) => new Date(start.getTime() + min * 60_000);

const et = (id: string, length: number) => ({
  id,
  active: true,
  length,
  title: `Service ${id}`,
  productId: `prod-${id}`,
  requiresConfirmation: false,
  slotInterval: null,
  beforeBuffer: 0,
  afterBuffer: 0,
  minimumBookingNotice: 0,
  periodType: 'unlimited',
  periodDays: null,
  schedulingType: null,
});

/** What the insert of one member returns — the service reads `resourceId`,
 *  `startTime` and `endTime` back off it. */
const inserted = (id: string) => [
  {
    id,
    orgId: 'org-1',
    resourceId: 'staff-1',
    startTime: start,
    endTime: at(45),
    status: 'accepted',
    productId: `prod-${id}`,
  },
];

/** The `.values()` payload of every insert, in write order — the only way to see
 *  what actually reached the row through the mock's throwaway chain proxies. */
function captureInserts(db: unknown) {
  const values: Record<string, unknown>[] = [];
  const target = db as Record<string, unknown>;
  const inner = target['insert'] as (...a: unknown[]) => Record<string, unknown>;
  target['insert'] = vi.fn((...args: unknown[]) => {
    const chain = inner(...args);
    return new Proxy(chain, {
      get(t, prop) {
        if (prop === 'values')
          return (v: Record<string, unknown>) => {
            values.push(v);
            return (t['values'] as (x: unknown) => unknown)(v);
          };
        return t[prop as string];
      },
    });
  });
  return values;
}

/** A three-procedure visit of 15 + 20 + 10 minutes on one free resource. */
function threeProcedureSequence(): unknown[] {
  return [
    // lengths lookup for the whole visit (order-insensitive: mapped by id)
    [
      { id: 'et-a', length: 15 },
      { id: 'et-b', length: 20 },
      { id: 'et-c', length: 10 },
    ],
    // ── lead member ──
    [et('et-a', 15)], // event type
    [{ resourceId: 'staff-1' }], // assignees
    [{ id: 'staff-1' }], // active resources
    [], // loadAvailability: schedules
    [], // loadBusyInTx
    inserted('b-a'), // insert … returning()
    [], // status log insert
    // ── member 2 (pinned + override: no availability/busy lookups) ──
    [et('et-b', 20)],
    [{ resourceId: 'staff-1' }],
    [{ id: 'staff-1' }],
    inserted('b-b'),
    [],
    // ── member 3 ──
    [et('et-c', 10)],
    [{ resourceId: 'staff-1' }],
    [{ id: 'staff-1' }],
    inserted('b-c'),
    [],
    // ── the one window conflict check ──
    [{ beforeBuffer: 0, afterBuffer: 0 }],
    [], // no neighbours
  ];
}

describe('createBookingGroup', () => {
  it('books every procedure on the SHARED window, stamped groupId/Seq/Length in pick order', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence(threeProcedureSequence());
    // The lead's slot check runs with the WHOLE visit as its occupancy.
    computeSlotsMock.mockReturnValue([{ start, resourceIds: ['staff-1'] }]);

    const rows = await createBookingGroup(ctx(db), {
      eventTypeIds: ['et-a', 'et-b', 'et-c'],
      start,
      attendeeName: 'Ana',
    });

    expect(rows.map((r) => r.id)).toEqual(['b-a', 'b-b', 'b-c']);

    // The lead is the ONLY member the slot engine is asked about, and it is asked
    // about the container window (15 + 20 + 10 = 45), stepping by the lead
    // service's own length so the grid is unchanged for the user.
    expect(computeSlotsMock).toHaveBeenCalledTimes(1);
    const asked = computeSlotsMock.mock.calls[0][0] as {
      eventType: { length: number; slotInterval: number | null };
    };
    expect(asked.eventType.length).toBe(45);
    expect(asked.eventType.slotInterval).toBe(15);

    // Only booking inserts carry an eventTypeId; the rest are status-log rows.
    const members = inserts.filter((v) => 'eventTypeId' in v);
    expect(members).toHaveLength(3);
    const groupId = (members[0].metadata as { groupId: string }).groupId;
    expect(groupId).toMatch(/^[0-9a-f-]{36}$/);
    expect(members.map((v) => v.metadata)).toEqual([
      { groupId, groupSeq: 0, groupLength: 15 },
      { groupId, groupSeq: 1, groupLength: 20 },
      { groupId, groupSeq: 2, groupLength: 10 },
    ]);
    // ONE window: every member shares start and end, and the end is the sum of
    // the members' own lengths with no buffer inserted between them.
    for (const v of members) {
      expect(v.startTime).toEqual(start);
      expect(v.endTime).toEqual(at(45));
      expect(v.resourceId).toBe('staff-1');
    }
    // Per-booking side effects stay per booking: one creation log row and one
    // stock accrual each.
    expect(inserts.filter((v) => 'toStatus' in v)).toHaveLength(3);
    expect(accrueMock).toHaveBeenCalledTimes(3);
  });

  it('409s when a non-member (e.g. a COMPLETED booking) clashes with the window', async () => {
    const { db, resolveSequence } = createMockDb();
    const seq = threeProcedureSequence();
    // 15:30–15:40 sits inside the 15:00–15:45 window but outside the lead's own
    // 15 minutes — only the whole-window check can see it.
    seq[seq.length - 1] = [
      { id: 'x', start: at(30), end: at(40), title: 'Manicure', metadata: null },
    ];
    resolveSequence(seq);
    computeSlotsMock.mockReturnValue([{ start, resourceIds: ['staff-1'] }]);

    const err = await createBookingGroup(ctx(db), {
      eventTypeIds: ['et-a', 'et-b', 'et-c'],
      start,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BookingConflictError);
    expect((err as BookingConflictError).conflicts.map((c) => c.id)).toEqual(['x']);
    // Rolled back with the transaction, so nothing accrued post-commit either.
    expect(accrueMock).not.toHaveBeenCalled();
  });

  it('refuses a visit of one procedure, and an unknown/inactive procedure', async () => {
    const { db } = createMockDb();
    await expect(createBookingGroup(ctx(db), { eventTypeIds: ['et-a'], start })).rejects.toThrow(
      'at least two procedures',
    );

    const missing = createMockDb();
    missing.resolveSequence([[{ id: 'et-a', length: 15 }]]); // et-b never came back
    await expect(
      createBookingGroup(ctx(missing.db), { eventTypeIds: ['et-a', 'et-b'], start }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});
