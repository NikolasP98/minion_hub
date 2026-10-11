/**
 * `unscheduleVisit` — "Desagendar" on the calendar's event context menu (owner
 * ask 2026-10-10). What is under test is the TRANSACTION BOUNDARY: the paid
 * ticket lines go back to the pending tray AND every live service of the event
 * is cancelled, in ONE transaction, or neither happens. Mock style mirrors
 * `scheduling-bookings-ticket-link.test.ts`.
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

import { unscheduleVisit } from './scheduling-bookings.service';

beforeEach(() => vi.clearAllMocks());

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

/** Records every `.set()` payload in write order — the mock's chains are
 *  throwaway proxies, so the `db.update` spy alone cannot see them (same helper
 *  as `scheduling-bookings-group.test.ts`). */
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

/** Same trick for `insert().values(...)` — the status-log row. */
function captureInserts(db: unknown) {
  const rows: Record<string, unknown>[] = [];
  const target = db as Record<string, unknown>;
  const inner = target['insert'] as (...a: unknown[]) => Record<string, unknown>;
  target['insert'] = vi.fn((...args: unknown[]) => {
    const chain = inner(...args);
    return new Proxy(chain, {
      get(t, prop) {
        if (prop === 'values')
          return (v: Record<string, unknown>) => {
            rows.push(v);
            return (t['values'] as (x: unknown) => unknown)(v);
          };
        return t[prop as string];
      },
    });
  });
  return rows;
}

/** The awaits one `setBookingStatusInTx` consumes: lock+read status, update the
 *  row, insert the log row, read the live package redemptions. */
const cancelOneMember = (status = 'accepted') => [[{ status }], [], [], []];

describe('unscheduleVisit', () => {
  it('releases the ticket lines and cancels every member in ONE transaction', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [{ metadata: { groupId: 'g1' }, resourceId: 'staff-1', status: 'accepted' }],
      [
        { id: 'b1', status: 'accepted' },
        { id: 'b2', status: 'accepted' },
      ],
      [{ id: 'line-1' }, { id: 'line-2' }], // the released ticket lines
      ...cancelOneMember(),
      ...cancelOneMember(),
    ]);

    const r = await unscheduleVisit(ctx(db), 'b1', { reason: null });

    expect(r).toEqual({ found: true, cancelled: ['b1', 'b2'], released: 2 });
    // ONE transaction for the release AND both cancels.
    expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);
    // First write unlinks the lines; then one status write per member.
    expect(sets[0]).toEqual({ bookingId: null });
    expect(sets.slice(1).map((s) => s.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('releases the accruals of each cancelled member AFTER the commit', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ metadata: { groupId: 'g1' }, resourceId: 'staff-1', status: 'accepted' }],
      [
        { id: 'b1', status: 'accepted' },
        { id: 'b2', status: 'accepted' },
      ],
      [{ id: 'line-1' }],
      ...cancelOneMember(),
      ...cancelOneMember(),
    ]);

    await unscheduleVisit(ctx(db), 'b1');

    expect(mocks.releaseAccruals.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['booking', 'b1'],
      ['booking', 'b2'],
    ]);
  });

  it('a lost accrual release does not undo the unschedule (fail-soft, retriggerable)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ metadata: null, resourceId: 'staff-1', status: 'accepted' }],
      [{ id: 'line-1' }],
      ...cancelOneMember(),
    ]);
    mocks.releaseAccruals.mockRejectedValueOnce(new Error('stock down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(unscheduleVisit(ctx(db), 'b1')).resolves.toEqual({
      found: true,
      cancelled: ['b1'],
      released: 1,
    });
    err.mockRestore();
  });

  it('covers an UNGROUPED booking as its own single-member event', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [{ metadata: null, resourceId: 'staff-1', status: 'accepted' }],
      [{ id: 'line-1' }],
      ...cancelOneMember(),
    ]);

    const r = await unscheduleVisit(ctx(db), 'b1');

    expect(r).toEqual({ found: true, cancelled: ['b1'], released: 1 });
    expect(sets[0]).toEqual({ bookingId: null });
    expect(sets[1]?.status).toBe('cancelled');
  });

  it('leaves an already-terminal member alone but still releases its lines', async () => {
    const { db, resolveSequence } = createMockDb();
    const sets = captureUpdates(db);
    resolveSequence([
      [{ metadata: { groupId: 'g1' }, resourceId: 'staff-1', status: 'cancelled' }],
      [
        { id: 'b1', status: 'cancelled' },
        { id: 'b2', status: 'accepted' },
      ],
      [{ id: 'line-1' }],
      ...cancelOneMember(),
    ]);

    const r = await unscheduleVisit(ctx(db), 'b1');

    expect(r).toEqual({ found: true, cancelled: ['b2'], released: 1 });
    expect(sets[0]).toEqual({ bookingId: null });
    expect(sets.slice(1).map((s) => s.status)).toEqual(['cancelled']);
    expect(mocks.releaseAccruals.mock.calls.map((c) => c[2])).toEqual(['b2']);
  });

  it('writes nothing for an id this org does not have — the caller 404s', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);

    const r = await unscheduleVisit(ctx(db), 'nope');

    expect(r).toEqual({ found: false, cancelled: [], released: 0 });
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    expect(mocks.releaseAccruals).not.toHaveBeenCalled();
  });

  it("stamps the status log with 'unscheduled' unless the caller names a reason", async () => {
    const { db, resolveSequence } = createMockDb();
    const rows = captureInserts(db);
    resolveSequence([
      [{ metadata: null, resourceId: 'staff-1', status: 'accepted' }],
      [{ id: 'line-1' }],
      ...cancelOneMember(),
    ]);

    await unscheduleVisit(ctx(db), 'b1');

    expect(rows[0]).toMatchObject({
      bookingId: 'b1',
      fromStatus: 'accepted',
      toStatus: 'cancelled',
      reason: 'unscheduled',
    });
  });
});
