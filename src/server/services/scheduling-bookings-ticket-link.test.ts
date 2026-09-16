import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { crmContacts } from '$server/db/pg-crm-schema';

/**
 * `bookAndLinkTicketLine` — the ONE write `/pos/sell?step=schedule` makes.
 *
 * What is under test is the TRANSACTION BOUNDARY, not the slot engine: the
 * booking row, the package redemption and the `pos_ticket_lines.booking_id`
 * claim either all land or none do. Mock style mirrors
 * `scheduling-bookings-packages.test.ts`.
 */
const computeSlotsMock = vi.fn<
  (input: { rangeStart: Date }) => Array<{ start: Date; resourceIds: string[] }>
>((input) => [{ start: input.rangeStart, resourceIds: ['staff-1'] }]);
vi.mock('$server/scheduling/slots', () => ({
  computeSlots: (input: { rangeStart: Date }) => computeSlotsMock(input),
}));

const redeemMock = vi.fn<(grantId: string) => Promise<{ id: string }>>(async () => ({
  id: 'red-1',
}));
vi.mock('./pos-packages.service', () => ({
  redeemSessionInTx: (_tx: unknown, _org: string, input: { grantId: string }) =>
    redeemMock(input.grantId),
  reverseRedemptionInTx: async (_tx: unknown, _org: string, id: string) => ({ id }),
  getGrant: async () => null,
}));
vi.mock('./pos-accounts.service', () => ({ getPlan: async () => null }));
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ timezone: 'America/Lima' }),
}));
vi.mock('./scheduling-slots.service', () => ({ serviceRulesOf: () => undefined }));
vi.mock('$server/events/emit', () => ({ emitHubEvent: async () => {} }));

const accrueMock = vi.fn<() => Promise<number>>(async () => 1);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: () => accrueMock(),
  releaseAccruals: async () => 1,
  accrualSummaryForSources: async () => [],
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { bookAndLinkTicketLine } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
  computeSlotsMock.mockImplementation((input) => [
    { start: input.rangeStart, resourceIds: ['staff-1'] },
  ]);
  redeemMock.mockImplementation(async () => ({ id: 'red-1' }));
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const et = {
  id: 'et-1',
  active: true,
  length: 30,
  title: 'Laser session',
  productId: 'prod-1',
  requiresConfirmation: false,
  slotInterval: null,
  beforeBuffer: 0,
  afterBuffer: 0,
  minimumBookingNotice: 0,
  periodType: 'unlimited',
  periodDays: null,
  schedulingType: null,
};

const start = new Date('2026-09-21T15:00:00.000Z');
const bookingRow = (id: string, status = 'accepted') => ({
  id,
  orgId: 'org-1',
  resourceId: 'staff-1',
  startTime: start,
  endTime: new Date(start.getTime() + 30 * 60_000),
  status,
  productId: 'prod-1',
});

/** The reads `bookOccurrenceInTx` makes for ONE occurrence (slot path). */
const occurrence = (row: unknown, crm: unknown[] = []) => [
  [et], // event type
  [{ resourceId: 'staff-1' }], // assignees
  [{ id: 'staff-1' }], // active resources
  [], // loadAvailability
  [], // loadBusyInTx
  ...crm, // ensureCrmContact, only when an attendee phone/email exists
  [row], // insert booking … returning()
  [], // insert sched_booking_status_log
];

/** ticket → line → (optional party phone lookup). */
const preamble = (
  opts: { partyId?: string | null; status?: string; kind?: string; bookingId?: string | null } = {},
) => [
  [{ status: opts.status ?? 'submitted', partyId: opts.partyId ?? null }],
  [{ kind: opts.kind ?? 'service', bookingId: opts.bookingId ?? null }],
];

const input = { ticketId: 'tk-1', lineId: 'ln-1', eventTypeId: 'et-1', start };

describe('bookAndLinkTicketLine', () => {
  it('books and stamps the line in ONE transaction, then accrues post-commit', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble(), ...occurrence(bookingRow('b-1')), [{ id: 'ln-1' }]]);

    const out = await bookAndLinkTicketLine(ctx(db), input);

    expect(out).toMatchObject({ created: true, booking: { id: 'b-1' } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).toHaveBeenCalledTimes(1); // post-commit, fail-soft
  });

  it('a failing line claim rolls the booking back — ONE transaction, nothing post-commit', async () => {
    const { db, resolveSequence } = createMockDb();
    // The guarded `is null` update matches nothing: another cashier won the line
    // between the read and the write.
    resolveSequence([...preamble(), ...occurrence(bookingRow('b-1')), []]);

    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'line_already_scheduled',
    });

    // The two discriminators, same as the series test: (a) the booking insert and
    // the claim ran inside a SINGLE transaction, so Postgres rolls the booking row
    // back with the throw — a two-call implementation would leave it committed;
    // (b) nothing reached the post-commit accrual, which only runs for bookings
    // that survived.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).not.toHaveBeenCalled();
  });

  it('a double-submit returns the SAME booking, creates nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble({ bookingId: 'b-1' }), [bookingRow('b-1')]]);

    const out = await bookAndLinkTicketLine(ctx(db), input);

    expect(out).toMatchObject({ created: false, booking: { id: 'b-1' } });
    expect(db.insert).not.toHaveBeenCalled();
    expect(accrueMock).not.toHaveBeenCalled();
  });

  it('a line pointing at a CANCELLED booking is stuck, not replayable', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble({ bookingId: 'b-1' }), [bookingRow('b-1', 'cancelled')]]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'line_already_scheduled',
    });
  });

  it("refuses a ticket that is not this org's", async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // org-scoped ticket read: no row
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses a void ticket', async () => {
    // Regression for the 2026-09-16 lifecycle-b QA finding: this test (and
    // the check it covers) used to compare against 'voided', which
    // voidTicket (pos.service.ts) never persists — it writes 'void' — so a
    // voided ticket could still be booked and linked after a reload.
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ status: 'void', partyId: null }]]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'ticket_void',
    });
  });

  it('refuses a line that is not a service', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble({ kind: 'product' })]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'line_not_service',
    });
  });

  it('an exhausted grant takes the booking AND the claim down with it', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble(), ...occurrence(bookingRow('b-1')), [{ id: 'ln-1' }]]);
    redeemMock.mockRejectedValueOnce(
      Object.assign(new Error('no sessions left'), { code: 'package_exhausted' }),
    );

    await expect(
      bookAndLinkTicketLine(ctx(db), { ...input, packageGrantId: 'grant-1' }),
    ).rejects.toMatchObject({ code: 'package_exhausted' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).not.toHaveBeenCalled();
  });

  it("falls back to the ticket party's phone so the reminder has a recipient", async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      ...preamble({ partyId: 'pt-1' }),
      [{ phone9: '987654321' }], // parties lookup
      // A phone reached bookOccurrenceInTx → the CRM bridge runs (it bails out
      // entirely when there is nothing to identify the attendee by).
      ...occurrence(bookingRow('b-1'), [[{ id: 'c-1' }], []]),
      [{ id: 'ln-1' }],
    ]);

    const out = await bookAndLinkTicketLine(ctx(db), input);

    expect(out.booking.id).toBe('b-1');
    expect(db.insert).toHaveBeenCalledWith(crmContacts);
  });
});
