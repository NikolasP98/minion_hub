import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { bookingTicketLinks } from './pos-accounts.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('bookingTicketLinks — sales and their products per booking (spec 120)', () => {
  it('asks nothing for an empty window', async () => {
    const { db } = createMockDb();
    expect((await bookingTicketLinks(ctx(db), [])).size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('skips the product statement when no booking is charged', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    expect((await bookingTicketLinks(ctx(db), ['b1', 'b2'])).size).toBe(0);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('attaches the product lines of each sale in two statements, whatever the booking count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { bookingId: 'b1', id: 't1', humanId: 'POS-1' },
        { bookingId: 'b2', id: 't1', humanId: 'POS-1' }, // one sale, two bookings
        { bookingId: 'b3', id: 't2', humanId: 'POS-2' },
      ],
      [
        { ticketId: 't1', description: 'Faja L', qty: '1', total: '0.00' },
        { ticketId: 't1', description: 'Crema', qty: '2', total: '80.00' },
      ],
    ]);

    const out = await bookingTicketLinks(ctx(db), ['b1', 'b2', 'b3', 'b4']);

    expect(db.select).toHaveBeenCalledTimes(2);
    const products = [
      { description: 'Faja L', qty: 1, total: 0 },
      { description: 'Crema', qty: 2, total: 80 },
    ];
    expect(out.get('b1')).toEqual([{ id: 't1', humanId: 'POS-1', products }]);
    expect(out.get('b2')).toEqual([{ id: 't1', humanId: 'POS-1', products }]);
    expect(out.get('b3')).toEqual([{ id: 't2', humanId: 'POS-2', products: [] }]);
    expect(out.has('b4')).toBe(false);
  });
});
