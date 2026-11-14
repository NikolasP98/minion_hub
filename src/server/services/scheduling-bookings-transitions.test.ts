/**
 * Spec 116 slice 5 — a closed appointment stays closed (FR-009 to FR-012).
 * `setBookingStatusInTx` is the one status owner: it refuses any change out of
 * a final status (cancelled, rejected, no_show, completed, or anything outside
 * the six) and, when a booking becomes cancelled or rejected, hands its paid
 * SERVICE lines on non-void tickets back to the tray in the same transaction.
 * Mock style mirrors `scheduling-bookings-unschedule.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { posTicketLines } from '$server/db/pg-pos-schema';
import { schedBookings } from '$server/db/pg-scheduling-schema';

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  accrualSummaryForSources: async () => [],
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));
vi.mock('./pos-packages.service', () => ({
  getGrant: async () => null,
  redeemSessionInTx: async () => ({ id: 'red-1' }),
  reverseRedemptionInTx: async (_tx: unknown, _org: string, id: string) => ({ id }),
}));
vi.mock('./pos-accounts.service', () => ({ getPlan: async () => null }));
vi.mock('./tag-links.service', () => ({
  getTagLinks: async () => new Map(),
  getContactTagsBulk: async () => new Map(),
}));

import {
  BookingTransitionError,
  cancelBooking,
  patchBooking,
  setBookingStatus,
} from './scheduling-bookings.service';

beforeEach(() => vi.clearAllMocks());

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const dialect = new PgDialect();

type Write = { table: unknown; set?: Record<string, unknown>; where?: SQL };

/** Records every `update(table).set(v).where(w)` in write order. */
function captureUpdates(db: unknown): Write[] {
  const writes: Write[] = [];
  const target = db as Record<string, unknown>;
  const inner = target['update'] as (...a: unknown[]) => Record<string, unknown>;
  target['update'] = vi.fn((table: unknown) => {
    const w: Write = { table };
    writes.push(w);
    const wrap = (chain: Record<string, unknown>): Record<string, unknown> =>
      new Proxy(chain, {
        get(t, prop) {
          if (prop === 'set')
            return (v: Record<string, unknown>) => {
              w.set = v;
              return wrap((t['set'] as (x: unknown) => Record<string, unknown>)(v));
            };
          if (prop === 'where')
            return (v: SQL) => {
              w.where = v;
              return (t['where'] as (x: unknown) => unknown)(v);
            };
          return t[prop as string];
        },
      });
    return wrap(inner(table));
  });
  return writes;
}

/** Counts `insert(...)` calls — the status-log row is the only insert here. */
const inserts = (db: unknown) => vi.mocked((db as { insert: () => unknown }).insert).mock.calls;

const lineClears = (writes: Write[]) => writes.filter((w) => w.table === posTicketLines);

describe('setBookingStatusInTx guard (FR-009, FR-011)', () => {
  for (const from of ['cancelled', 'rejected', 'no_show', 'completed', 'archived']) {
    it(`refuses ${from} → accepted with invalid_transition and writes nothing`, async () => {
      const { db, resolveSequence } = createMockDb();
      const writes = captureUpdates(db);
      resolveSequence([[{ status: from }]]);

      const err = await setBookingStatus(ctx(db), 'b1', 'accepted').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BookingTransitionError);
      expect((err as BookingTransitionError).code).toBe('invalid_transition');
      expect(writes).toEqual([]);
      expect(inserts(db)).toHaveLength(0);
    });
  }

  it('a same-status write on a final booking stays a silent no-op', async () => {
    const { db, resolveSequence } = createMockDb();
    const writes = captureUpdates(db);
    resolveSequence([[{ status: 'cancelled' }]]);

    await expect(setBookingStatus(ctx(db), 'b1', 'cancelled')).resolves.toBeUndefined();
    expect(writes).toEqual([]);
  });

  for (const [from, to] of [
    ['pending', 'accepted'],
    ['accepted', 'pending'],
    ['accepted', 'completed'],
    ['pending', 'no_show'],
  ] as const) {
    it(`live ${from} → ${to} writes the row and one log row, and keeps every ticket link`, async () => {
      const { db, resolveSequence } = createMockDb();
      const writes = captureUpdates(db);
      resolveSequence([[{ status: from }]]);

      await setBookingStatus(ctx(db), 'b1', to);

      expect(writes.map((w) => w.table)).toEqual([schedBookings]);
      expect(writes[0].set?.status).toBe(to);
      expect(inserts(db)).toHaveLength(1);
      // no_show keeps its paid line (owner decision in the spec).
      expect(lineClears(writes)).toEqual([]);
    });
  }
});

describe('setBookingStatusInTx releases paid service lines (FR-012)', () => {
  for (const to of ['cancelled', 'rejected']) {
    it(`${to}: unlinks this booking's service lines of non-void tickets, in the same transaction`, async () => {
      const { db, resolveSequence } = createMockDb();
      const writes = captureUpdates(db);
      resolveSequence([[{ status: 'accepted' }]]);

      await setBookingStatus(ctx(db), 'b1', to);

      expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);
      const [clear] = lineClears(writes);
      expect(clear?.set).toEqual({ bookingId: null });
      const q = dialect.sqlToQuery(clear!.where!);
      // This booking only, service lines only (a product line keeps its link),
      // and only on tickets that are not void.
      expect(q.sql).toContain('"pos_ticket_lines"."booking_id" = $');
      expect(q.sql).toContain('"pos_ticket_lines"."kind" = $');
      expect(q.sql).toMatch(/"pos_ticket_lines"."ticket_id" in \(select/);
      expect(q.sql).toContain(`"pos_tickets"."status" not in ('void', 'voided')`);
      expect(q.params).toEqual(['org-1', 'b1', 'service', 'org-1']);
    });
  }
});

describe('patchBooking delegates status to the status owner (FR-010)', () => {
  const full = { id: 'b1', orgId: 'org-1', status: 'accepted', title: 'Haircut' };

  it('a status PATCH goes through the guard: one log row, the line release, the fresh row back', async () => {
    const { db, resolveSequence } = createMockDb();
    const writes = captureUpdates(db);
    resolveSequence([
      [{ id: 'b1', status: 'accepted' }], // patchBooking lock
      [full], // updateBookingInTx: existing
      [full], // updateBookingInTx: row read
      [{ status: 'accepted' }], // setBookingStatusInTx: lock + read
      [], // status update
      [], // status-log insert
      [], // live redemptions
      [], // ticket-line release
      [{ ...full, status: 'cancelled' }], // re-select for the return value
    ]);

    const row = await patchBooking(ctx(db), 'b1', { status: 'cancelled' });

    expect(row.status).toBe('cancelled');
    expect(inserts(db)).toHaveLength(1);
    expect(writes.map((w) => w.table)).toEqual([schedBookings, posTicketLines]);
  });

  it('a PATCH on a final booking is refused whole, other fields included', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b1', status: 'no_show' }],
      [{ ...full, status: 'no_show' }],
      [], // title update
      [], // audit insert
      [{ ...full, status: 'no_show', title: 'New' }],
      [{ status: 'no_show' }], // setBookingStatusInTx: lock + read → refused
    ]);

    await expect(
      patchBooking(ctx(db), 'b1', { status: 'accepted', title: 'New' }),
    ).rejects.toBeInstanceOf(BookingTransitionError);
  });
});

describe('cancelBooking scope following (FR-009 edge case)', () => {
  it('skips a final root and still cancels the later occurrences', async () => {
    const { db, resolveSequence } = createMockDb();
    const writes = captureUpdates(db);
    resolveSequence([
      [{ id: 'b1', seriesId: 's1', seriesIndex: 1, status: 'completed' }],
      [{ id: 'b2' }, { id: 'b3' }],
      // b2 then b3: lock + read, update, log, redemptions, line release.
      [{ status: 'accepted' }],
      [],
      [],
      [],
      [],
      [{ status: 'pending' }],
    ]);

    const ids = await cancelBooking(ctx(db), 'b1', { scope: 'following' });

    expect(ids).toEqual(['b2', 'b3']);
    expect(writes.filter((w) => w.table === schedBookings).map((w) => w.set?.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  });

  it('a final root with nothing after it answers the refusal, not a 404', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'b1', seriesId: 's1', seriesIndex: 3, status: 'completed' }],
      [],
      [{ status: 'completed' }],
    ]);

    await expect(cancelBooking(ctx(db), 'b1', { scope: 'following' })).rejects.toBeInstanceOf(
      BookingTransitionError,
    );
  });
});
