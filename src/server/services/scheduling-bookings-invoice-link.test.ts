import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: async () => 0,
  releaseAccruals: async () => 0,
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

import { listBookingsForInvoice } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const explicitRow = {
  id: 'b1',
  title: 'Haircut',
  startTime: new Date('2026-09-10T15:00:00.000Z'),
  endTime: new Date('2026-09-10T15:30:00.000Z'),
  status: 'accepted',
  resourceName: 'Alice',
};
const ticketRow = {
  id: 'b2',
  title: 'Colour',
  startTime: new Date('2026-09-11T15:00:00.000Z'),
  endTime: new Date('2026-09-11T16:00:00.000Z'),
  status: 'completed',
  resourceName: 'Bob',
};

describe('listBookingsForInvoice', () => {
  it('returns [] when the invoice does not belong to this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // invoice lookup — no hit

    const rows = await listBookingsForInvoice(ctx(db), 'inv-x');

    expect(rows).toEqual([]);
  });

  it('unions the explicit invoice_id route with the transitive POS-ticket route, tagging `via`', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ providerRef: 'ref-1' }], // invoice lookup
      [explicitRow], // explicit sched_bookings.invoice_id = invoiceId
      [ticketRow], // pos_ticket_lines → pos_tickets → sched_bookings
    ]);

    const rows = await listBookingsForInvoice(ctx(db), 'inv-1');

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 'b1')).toMatchObject({ via: 'explicit' });
    expect(rows.find((r) => r.id === 'b2')).toMatchObject({ via: 'ticket' });
    // Newest first.
    expect(rows[0].id).toBe('b2');
  });

  it('dedupes a booking present on both routes, keeping the explicit label', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ providerRef: 'ref-1' }],
      [explicitRow], // b1 explicit
      [explicitRow], // b1 also reachable via the ticket route
    ]);

    const rows = await listBookingsForInvoice(ctx(db), 'inv-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'b1', via: 'explicit' });
  });

  it('skips the ticket-route query when the invoice has no providerRef', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ providerRef: null }], // invoice lookup — never reconciled to a POS ticket
      [explicitRow], // explicit route still runs
    ]);

    const rows = await listBookingsForInvoice(ctx(db), 'inv-1');

    expect(rows).toEqual([{ ...explicitRow, via: 'explicit' }]);
  });
});
