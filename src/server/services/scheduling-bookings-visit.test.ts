/**
 * The services of ONE event (owner ask 2026-10-07: "events are separate from
 * treatments; an event can contain one or more services"): `addServiceToVisit`,
 * `removeServiceFromVisit` and the `visit` facet `getBookingDetail` serves to
 * the drawer. Same mock-db style as `scheduling-bookings-group{,-create}.test.ts`
 * — the pure window math already has its own tests (`planGroupMerge`), so this
 * file is about what reaches the ROWS: the stamps, the window, the status, the
 * re-lay after a removal and the reference gate in front of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mocks = vi.hoisted(() => ({
  releaseAccruals: vi.fn<(ctx: unknown, source: string, sourceId: string) => Promise<number>>(
    async () => 0,
  ),
}));

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  accrualSummaryForSources: async () => [],
  releaseAccruals: (ctx: unknown, source: string, sourceId: string) =>
    mocks.releaseAccruals(ctx, source, sourceId),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));
vi.mock('./pos-packages.service', () => ({ getGrant: async () => null }));
vi.mock('./pos-accounts.service', () => ({ getPlan: async () => null }));
vi.mock('./tag-links.service', () => ({
  getTagLinks: async () => new Map(),
  getContactTagsBulk: async () => new Map(),
}));

import {
  addServiceToVisit,
  removeServiceFromVisit,
  getBookingDetail,
  MAX_GROUP_MEMBERS,
  SlotUnavailableError,
  BookingConflictError,
  BookingReferencedError,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const start = new Date('2026-10-07T15:00:00.000Z');
const at = (min: number) => new Date(start.getTime() + min * 60_000);

/** An event type as the service selects it. */
const et = (id: string, length: number) => ({
  id,
  orgId: 'org-1',
  active: true,
  length,
  title: `Service ${id}`,
  productId: null,
  requiresConfirmation: false,
  slotInterval: null,
  beforeBuffer: 0,
  afterBuffer: 0,
  minimumBookingNotice: 0,
  periodType: 'unlimited',
  periodDays: null,
  schedulingType: null,
  kindId: null,
});

/** A booking row with every column `addServiceToVisit`/`removeServiceFromVisit`
 *  read off it (the anchor select is a full `select()`). */
const booking = (
  id: string,
  from: Date,
  to: Date,
  metadata: Record<string, unknown> | null = null,
  patch: Record<string, unknown> = {},
) => ({
  id,
  orgId: 'org-1',
  status: 'accepted',
  eventTypeId: 'et-a',
  resourceId: 'staff-1',
  startTime: from,
  endTime: to,
  metadata,
  title: 'Botox',
  partyId: null,
  crmContactId: 'c1',
  attendeeName: 'Ana',
  attendeeEmail: null,
  attendeePhone: null,
  kindId: null,
  productId: null,
  ...patch,
});

/** What the new member's insert returns — the service reads the row back. */
const insertedMember = (id: string, to: Date) => [
  { ...booking(id, start, to, null), productId: null },
];

/** The `.values()` payload of every insert, in write order. */
function captureInserts(db: unknown) {
  return captureChain(db, 'insert', 'values');
}
/** The `.set()` payload of every update, in write order. */
function captureUpdates(db: unknown) {
  return captureChain(db, 'update', 'set');
}
function captureChain(db: unknown, top: string, leaf: string) {
  const seen: Record<string, unknown>[] = [];
  const target = db as Record<string, unknown>;
  const inner = target[top] as (...a: unknown[]) => Record<string, unknown>;
  target[top] = vi.fn((...args: unknown[]) => {
    const chain = inner(...args);
    return new Proxy(chain, {
      get(t, prop) {
        if (prop === leaf)
          return (v: Record<string, unknown>) => {
            seen.push(v);
            return (t[leaf] as (x: unknown) => unknown)(v);
          };
        return t[prop as string];
      },
    });
  });
  return seen;
}

/** The `{groupId,groupSeq,groupLength}` merged into `metadata` by an UPDATE, or
 *  null when the write stripped the group keys instead. */
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

/** The pinned-member insert's own query tail: event type, assignees, active
 *  resources, the in-org crm contact check, the row, the status-log row. */
function memberInsertSequence(id: string, service: ReturnType<typeof et>, windowEnd: Date) {
  return [
    [service],
    [{ resourceId: 'staff-1' }],
    [{ id: 'staff-1' }],
    [{ id: 'c1' }],
    insertedMember(id, windowEnd),
    [],
  ];
}

describe('addServiceToVisit', () => {
  it('turns an UNGROUPED booking into a visit: new groupId, window grows, both stamped', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    const updates = captureUpdates(db);
    resolveSequence([
      [booking('b-a', start, at(30))], // anchor, for update
      [et('et-b', 20)], // the service being added
      ...memberInsertSequence('b-b', et('et-b', 20), at(50)),
      [], // writeGroupMember(anchor)
      [], // the one window conflict check
    ]);

    const out = await addServiceToVisit(ctx(db), 'b-a', 'et-b');

    expect(out.members).toBe(2);
    expect(out.booking.id).toBe('b-b');
    expect(out.groupId).toMatch(/^[0-9a-f-]{36}$/);

    // The new member lands on the GROWN window, stamped seq 1 with its OWN
    // minutes, pinned to the anchor's resource and carrying its client.
    expect(inserts[0]).toMatchObject({
      resourceId: 'staff-1',
      startTime: start,
      endTime: at(50),
      status: 'accepted',
      crmContactId: 'c1',
      attendeeName: 'Ana',
      metadata: { groupId: out.groupId, groupSeq: 1, groupLength: 20 },
    });
    // The anchor keeps its pre-add duration as its own length (30), not the window's 50.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ startTime: start, endTime: at(50) });
    expect(stampOf(updates[0])).toEqual({
      groupId: out.groupId,
      groupSeq: 0,
      groupLength: 30,
    });
  });

  it('adds to an EXISTING visit: seq = max+1, window grows, every member rewritten', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    const updates = captureUpdates(db);
    const members = [
      {
        id: 'm-a',
        startTime: start,
        endTime: at(50),
        metadata: { groupId: 'g1', groupSeq: 0, groupLength: 30 },
        eventTypeId: 'et-a',
        resourceId: 'staff-1',
        status: 'accepted',
      },
      {
        id: 'm-b',
        startTime: start,
        endTime: at(50),
        metadata: { groupId: 'g1', groupSeq: 1, groupLength: 20 },
        eventTypeId: 'et-b',
        resourceId: 'staff-1',
        status: 'accepted',
      },
    ];
    resolveSequence([
      [booking('m-b', start, at(50), { groupId: 'g1', groupSeq: 1, groupLength: 20 })],
      [et('et-c', 10)],
      members,
      ...memberInsertSequence('m-c', et('et-c', 10), at(60)),
      [], // update m-a
      [], // update m-b
      [], // conflict check
    ]);

    const out = await addServiceToVisit(ctx(db), 'm-b', 'et-c');

    expect(out).toMatchObject({ groupId: 'g1', booking: { id: 'm-c' }, members: 3 });
    expect(inserts[0]).toMatchObject({
      startTime: start,
      endTime: at(60),
      metadata: { groupId: 'g1', groupSeq: 2, groupLength: 10 },
    });
    expect(updates.map((u) => [u.startTime, u.endTime])).toEqual([
      [start, at(60)],
      [start, at(60)],
    ]);
    expect(updates.map(stampOf)).toEqual([
      { groupId: 'g1', groupSeq: 0, groupLength: 30 },
      { groupId: 'g1', groupSeq: 1, groupLength: 20 },
    ]);
  });

  it('inherits a live visit status (pending stays pending)', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence([
      [booking('b-a', start, at(30), null, { status: 'pending' })],
      [et('et-b', 20)],
      ...memberInsertSequence('b-b', et('et-b', 20), at(50)),
      [],
      [],
    ]);

    await addServiceToVisit(ctx(db), 'b-a', 'et-b');

    expect(inserts[0]).toMatchObject({ status: 'pending' });
    // The status-log creation row records the SAME status.
    expect(inserts[1]).toMatchObject({ fromStatus: null, toStatus: 'pending' });
  });

  it('does NOT inherit completed — the new service has not been performed', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence([
      [booking('b-a', start, at(30), null, { status: 'completed' })],
      [et('et-b', 20)],
      ...memberInsertSequence('b-b', et('et-b', 20), at(50)),
      [],
      [],
    ]);

    await addServiceToVisit(ctx(db), 'b-a', 'et-b');

    // `completed` is what realises stock accrual; a service born completed
    // would skip it. It is accepted and completed on its own.
    expect(inserts[0]).toMatchObject({ status: 'accepted' });
    expect(inserts[1]).toMatchObject({ fromStatus: null, toStatus: 'accepted' });
  });

  it('falls back to accepted when the anchor no longer occupies the column', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence([
      [booking('b-a', start, at(30), null, { status: 'cancelled' })],
      [et('et-b', 20)],
      ...memberInsertSequence('b-b', et('et-b', 20), at(50)),
      [],
      [],
    ]);

    await addServiceToVisit(ctx(db), 'b-a', 'et-b');

    expect(inserts[0]).toMatchObject({ status: 'accepted' });
  });

  it('refuses an unknown or inactive event type', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[booking('b-a', start, at(30))], []]);

    await expect(addServiceToVisit(ctx(db), 'b-a', 'et-gone')).rejects.toBeInstanceOf(
      SlotUnavailableError,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it(`refuses a visit beyond MAX_GROUP_MEMBERS (${MAX_GROUP_MEMBERS})`, async () => {
    const { db, resolveSequence } = createMockDb();
    const full = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => ({
      id: `m-${i}`,
      startTime: start,
      endTime: at(30),
      metadata: { groupId: 'g1', groupSeq: i, groupLength: 10 },
      eventTypeId: 'et-a',
      resourceId: 'staff-1',
      status: 'accepted',
    }));
    resolveSequence([
      [booking('m-0', start, at(30), { groupId: 'g1', groupSeq: 0, groupLength: 10 })],
      [et('et-b', 20)],
      full,
    ]);

    await expect(addServiceToVisit(ctx(db), 'm-0', 'et-b')).rejects.toThrow(/capped at/);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses a resource that is not an assignee of the added service', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [booking('b-a', start, at(30))],
      [et('et-b', 20)],
      [et('et-b', 20)],
      [{ resourceId: 'staff-9' }], // someone else entirely
    ]);

    const err = await addServiceToVisit(ctx(db), 'b-a', 'et-b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlotUnavailableError);
    expect((err as SlotUnavailableError).reason).toBe('resource_not_assigned');
  });

  it('409s when the GROWN window lands on a third booking, and overrides on demand', async () => {
    const neighbour = [
      {
        id: 'other',
        start: at(40),
        end: at(70),
        title: 'Someone else',
        metadata: null,
      },
    ];
    const sequence = () => [
      [booking('b-a', start, at(30))],
      [et('et-b', 20)],
      ...memberInsertSequence('b-b', et('et-b', 20), at(50)),
      [], // writeGroupMember(anchor)
      neighbour, // the conflict check finds it
    ];

    const refused = createMockDb();
    refused.resolveSequence(sequence());
    await expect(addServiceToVisit(ctx(refused.db), 'b-a', 'et-b')).rejects.toBeInstanceOf(
      BookingConflictError,
    );

    const forced = createMockDb();
    // With overrideConflicts the check is never issued at all, so the neighbour
    // slot is simply never read.
    forced.resolveSequence(sequence());
    await expect(
      addServiceToVisit(ctx(forced.db), 'b-a', 'et-b', { overrideConflicts: true }),
    ).resolves.toMatchObject({ members: 2 });
  });
});

/** A visit member as `selectGroupMembers` returns it. */
const vm = (id: string, length: number, seq: number, to: Date) => ({
  id,
  startTime: start,
  endTime: to,
  metadata: { groupId: 'g1', groupSeq: seq, groupLength: length },
  eventTypeId: `et-${id}`,
  resourceId: 'staff-1',
  status: 'accepted',
});

/** `collectBookingReferences` + `deleteBookingRowInTx` slots: three reference
 *  lookups, then tag links, reminders, the audit row and the booking row. */
const noReferences = [[], [], []];
const rowDeletes = [[], [], [], []];

describe('removeServiceFromVisit', () => {
  it('removes one of three: window shrinks by its own length, survivors re-seqed', async () => {
    const { db, resolveSequence } = createMockDb();
    const updates = captureUpdates(db);
    resolveSequence([
      [booking('m-b', start, at(60), { groupId: 'g1', groupSeq: 1, groupLength: 20 })],
      ...noReferences,
      [vm('m-a', 30, 0, at(60)), vm('m-b', 20, 1, at(60)), vm('m-c', 10, 2, at(60))],
      ...rowDeletes,
      [], // update m-a
      [], // update m-c
    ]);

    const out = await removeServiceFromVisit(ctx(db), 'm-b');

    expect(out).toEqual({ removed: 'm-b', groupId: 'g1', destroyed: false });
    expect(updates.map((u) => [u.startTime, u.endTime])).toEqual([
      [start, at(40)],
      [start, at(40)],
    ]);
    expect(updates.map(stampOf)).toEqual([
      { groupId: 'g1', groupSeq: 0, groupLength: 30 },
      { groupId: 'g1', groupSeq: 1, groupLength: 10 },
    ]);
    expect(mocks.releaseAccruals).toHaveBeenCalledWith(expect.anything(), 'booking', 'm-b');
  });

  it('removing one of two DESTROYS the container: survivor stripped, own duration back', async () => {
    const { db, resolveSequence } = createMockDb();
    const updates = captureUpdates(db);
    resolveSequence([
      [booking('m-b', start, at(50), { groupId: 'g1', groupSeq: 1, groupLength: 20 })],
      ...noReferences,
      [vm('m-a', 30, 0, at(50)), vm('m-b', 20, 1, at(50))],
      ...rowDeletes,
      [], // update m-a
    ]);

    const out = await removeServiceFromVisit(ctx(db), 'm-b');

    expect(out).toEqual({ removed: 'm-b', groupId: 'g1', destroyed: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ startTime: start, endTime: at(30) });
    expect(stampOf(updates[0])).toBeNull(); // group keys stripped
  });

  it('refuses a referenced service and changes NOTHING', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [booking('m-b', start, at(60), { groupId: 'g1', groupSeq: 1, groupLength: 20 })],
      [{ bookingId: 'm-b' }], // a pos_ticket_lines row charges it
      [],
      [],
    ]);

    const err = await removeServiceFromVisit(ctx(db), 'm-b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookingReferencedError);
    expect((err as BookingReferencedError).references).toEqual(['ticket']);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(mocks.releaseAccruals).not.toHaveBeenCalled();
  });

  it('on an UNGROUPED booking it is a plain delete', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[booking('b-solo', start, at(30))], ...noReferences, ...rowDeletes]);

    const out = await removeServiceFromVisit(ctx(db), 'b-solo');

    expect(out).toEqual({ removed: 'b-solo', groupId: null, destroyed: false });
    expect(db.update).not.toHaveBeenCalled();
    expect(mocks.releaseAccruals).toHaveBeenCalledWith(expect.anything(), 'booking', 'b-solo');
  });

  it('404-equivalent: an unknown id throws before any write', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);

    await expect(removeServiceFromVisit(ctx(db), 'nope')).rejects.toThrow('booking not found');
    expect(db.delete).not.toHaveBeenCalled();
  });
});

/** The detail read's own prefix: booking, event type, resource, status history,
 *  then the ticket facet's first query (empty ⇒ it stops there). */
const detailPrefix = (metadata: Record<string, unknown> | null) => [
  [{ ...booking('m-a', start, at(50), metadata), crmContactId: null }],
  [],
  [],
  [],
  [],
];

describe('getBookingDetail().visit', () => {
  it('is null for a single-service event', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(detailPrefix(null));

    const detail = await getBookingDetail(ctx(db), 'm-a');

    expect(detail?.visit).toBeNull();
  });

  it('lists every member of ANY status with its own minutes, paid and referenced', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      ...detailPrefix({ groupId: 'g1', groupSeq: 0, groupLength: 30 }),
      // members: seq order, cancelled one included
      [
        { ...vm('m-b', 20, 1, at(50)), status: 'cancelled' },
        vm('m-a', 30, 0, at(50)),
        { ...vm('m-c', 10, 2, at(50)), eventTypeId: 'et-gone' },
      ],
      // event type titles (et-gone deliberately absent)
      [
        { id: 'et-m-a', title: 'Botox' },
        { id: 'et-m-b', title: 'Peeling' },
      ],
      [{ bookingId: 'm-a' }], // a non-void ticket line charged m-a
      [{ bookingId: 'm-a' }], // collectBookingReferences: ticket
      [], // order
      [{ bookingId: 'm-c' }], // realized accrual
    ]);

    const detail = await getBookingDetail(ctx(db), 'm-a');

    expect(detail?.visit?.groupId).toBe('g1');
    expect(detail?.visit?.members).toEqual([
      {
        id: 'm-a',
        seq: 0,
        eventTypeId: 'et-m-a',
        eventTypeTitle: 'Botox',
        minutes: 30,
        status: 'accepted',
        paid: true,
        referenced: ['ticket'],
      },
      {
        id: 'm-b',
        seq: 1,
        eventTypeId: 'et-m-b',
        eventTypeTitle: 'Peeling',
        minutes: 20,
        status: 'cancelled',
        paid: false,
        referenced: [],
      },
      {
        id: 'm-c',
        seq: 2,
        eventTypeId: 'et-gone',
        eventTypeTitle: '',
        minutes: 10,
        status: 'accepted',
        paid: false,
        referenced: ['accrual'],
      },
    ]);
  });
});
