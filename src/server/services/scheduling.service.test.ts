/**
 * `listEventTypes`' catalog-money join — the Price column of the appointment
 * form's Services table. Same mock-db style as the booking suites: what is
 * under test is the PROJECTION (which price reaches the caller, and what
 * "unpriced" looks like), not the SQL the LEFT JOIN compiles to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { listEventTypes } from './scheduling.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

/** An event-type row as the join returns it, beside its product's unit price
 *  (null = no product, an inactive product, or a missing one — the LEFT JOIN
 *  cannot tell them apart and neither can the operator). */
const joined = (id: string, productId: string | null, unitPrice: string | null) => ({
  type: { id, orgId: 'org-1', title: `Service ${id}`, length: 30, productId, active: true },
  unitPrice,
});

describe('listEventTypes catalog price', () => {
  it('carries the joined unit price and the org currency per service', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [joined('et-a', 'p-a', '120.00'), joined('et-b', null, null)],
      [{ currency: 'PEN' }],
      [{ eventTypeId: 'et-a', resourceId: 'staff-1' }],
    ]);

    const rows = await listEventTypes(ctx(db));

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'et-a',
        price: 120,
        currency: 'PEN',
        resourceIds: ['staff-1'],
      }),
      // No product ⇒ no price. NOT 0: the column must render "—".
      expect.objectContaining({ id: 'et-b', price: null, currency: 'PEN', resourceIds: [] }),
    ]);
  });

  it('reads an unparseable stored price as unpriced rather than free', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[joined('et-a', 'p-a', 'NaN')], [{ currency: 'PEN' }], []]);

    const [row] = await listEventTypes(ctx(db));

    expect(row.price).toBeNull();
  });

  it('still lists the services when POS has no currency to offer', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[joined('et-a', 'p-a', '50.00')], [], []]);

    const [row] = await listEventTypes(ctx(db));

    // `getPosCurrencyInTx` falls back to the POS default when the row is absent.
    expect(row).toMatchObject({ price: 50, currency: 'PEN' });
  });

  it('skips both the currency and the link read when the org has no services', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);

    expect(await listEventTypes(ctx(db))).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
