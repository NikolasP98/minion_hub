/**
 * Products on an event (spec 2026-10-10-hub-catalog-service-unification
 * §Slice 4): `addProductToVisit`, `removeProductFromVisit`, `setVisitProductQty`
 * and the `visitProductsForAnchor` read facet, plus the anchor resolution they
 * all share. Same mock-db style as `scheduling-bookings-visit.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  accrualSummaryForSources: async () => [],
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import {
  addProductToVisit,
  removeProductFromVisit,
  setVisitProductQty,
  resolveAnchorBookingId,
  visitProductsForAnchor,
} from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

/** The `.values()`/`.set()` payload of every insert/update, in write order —
 *  same wrapper `scheduling-bookings-visit.test.ts` uses. */
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
const captureInserts = (db: unknown) => captureChain(db, 'insert', 'values');
const captureUpdates = (db: unknown) => captureChain(db, 'update', 'set');

/** `visitMembers`'s own row select (`metadata`, `resourceId`). */
const anchorRow = (groupId: string | null, seq: number | null = null) => ({
  metadata: groupId ? { groupId, groupSeq: seq } : null,
  resourceId: 'staff-1',
});
/** `visitMembers`'s member select, in whatever order the mock returns it —
 *  `sortGroupMembers` inside the service re-orders by `groupSeq`. */
const member = (id: string, groupId: string, seq: number, status = 'accepted') => ({
  id,
  startTime: new Date('2026-10-10T15:00:00.000Z'),
  endTime: new Date('2026-10-10T15:30:00.000Z'),
  metadata: { groupId, groupSeq: seq },
  status,
});

describe('resolveAnchorBookingId', () => {
  it('returns the booking itself when it is ungrouped', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[anchorRow(null)]]);
    await expect(resolveAnchorBookingId(ctx(db), 'solo')).resolves.toBe('solo');
  });

  it('returns the visit lead (seq 0), not whichever member was passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [anchorRow('g1', 1)],
      [member('lead-x', 'g1', 0), member('member-y', 'g1', 1)],
    ]);
    await expect(resolveAnchorBookingId(ctx(db), 'member-y')).resolves.toBe('lead-x');
  });
});

describe('addProductToVisit', () => {
  it('inserts against the ANCHOR, not whichever member id was passed', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence([
      [anchorRow('g1', 1)],
      [member('lead-x', 'g1', 0), member('member-y', 'g1', 1)],
      [{ id: 'prod-1' }],
      [],
    ]);

    await addProductToVisit(ctx(db), 'member-y', 'prod-1', 2);

    expect(inserts).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        bookingId: 'lead-x',
        productId: 'prod-1',
        qty: '2',
      }),
    ]);
  });

  it('defaults qty to 1', async () => {
    const { db, resolveSequence } = createMockDb();
    const inserts = captureInserts(db);
    resolveSequence([[anchorRow(null)], [{ id: 'prod-1' }], []]);

    await addProductToVisit(ctx(db), 'solo', 'prod-1');

    expect(inserts).toEqual([expect.objectContaining({ bookingId: 'solo', qty: '1' })]);
  });

  it('refuses an unknown, inactive, or foreign product', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[anchorRow(null)], []]);
    await expect(addProductToVisit(ctx(db), 'solo', 'nope')).rejects.toThrow('product not found');
  });

  it('refuses a non-positive qty before touching the db', async () => {
    const { db } = createMockDb();
    await expect(addProductToVisit(ctx(db), 'solo', 'prod-1', 0)).rejects.toThrow(
      'qty must be greater than 0',
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('removeProductFromVisit', () => {
  it('deletes against the ANCHOR, not whichever member id was passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [anchorRow('g1', 1)],
      [member('lead-x', 'g1', 0), member('member-y', 'g1', 1)],
    ]);

    await removeProductFromVisit(ctx(db), 'member-y', 'prod-1');

    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});

describe('setVisitProductQty', () => {
  it('updates the qty against the ANCHOR', async () => {
    const { db, resolveSequence } = createMockDb();
    const updates = captureUpdates(db);
    resolveSequence([[anchorRow(null)], [{ id: 'row-1' }]]);

    await setVisitProductQty(ctx(db), 'solo', 'prod-1', 3);

    expect(updates).toEqual([expect.objectContaining({ qty: '3' })]);
  });

  it('throws when the product is not on this event', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[anchorRow(null)], []]);
    await expect(setVisitProductQty(ctx(db), 'solo', 'prod-1', 2)).rejects.toThrow(
      'product not found on this event',
    );
  });

  it('refuses a non-positive qty before touching the db', async () => {
    const { db } = createMockDb();
    await expect(setVisitProductQty(ctx(db), 'solo', 'prod-1', 0)).rejects.toThrow(
      'qty must be greater than 0',
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('visitProductsForAnchor', () => {
  it('marks a product paid only when a non-void ticket line charged it', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { productId: 'prod-1', qty: '2', name: 'Lip Defender', unitPrice: '45.00' },
        { productId: 'prod-2', qty: '1', name: 'Serum', unitPrice: null },
      ],
      [{ productId: 'prod-1' }],
    ]);

    const rows = await visitProductsForAnchor(ctx(db), 'anchor-1');

    expect(rows).toEqual([
      { productId: 'prod-1', name: 'Lip Defender', unitPrice: 45, qty: 2, paid: true },
      { productId: 'prod-2', name: 'Serum', unitPrice: null, qty: 1, paid: false },
    ]);
  });

  it('skips the paid-ticket lookup entirely when the event has no products', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);

    await expect(visitProductsForAnchor(ctx(db), 'anchor-1')).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
