import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { schedBookings } from '$server/db/pg-scheduling-schema';

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
const auditMock = vi.fn();
vi.mock('./activity.service', () => ({
  recordAuditInTx: (...args: unknown[]) => auditMock(...args),
}));

const accrueMock = vi.fn<() => Promise<number>>(async () => 1);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: () => accrueMock(),
  releaseAccruals: async () => 1,
  accrualSummaryForSources: async () => [],
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { bookAndLinkTicketLine, createBooking } from './scheduling-bookings.service';

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
  opts: {
    partyId?: string | null;
    status?: string;
    kind?: string;
    bookingId?: string | null;
    productId?: string;
    planId?: string | null;
  } = {},
) => [
  [{ status: opts.status ?? 'submitted', partyId: opts.partyId ?? null }],
  [
    {
      kind: opts.kind ?? 'service',
      bookingId: opts.bookingId ?? null,
      finProductId: opts.productId ?? 'prod-1',
      planId: opts.planId ?? null,
    },
  ],
];

const input = { ticketId: 'tk-1', lineId: 'ln-1', eventTypeId: 'et-1', start };

describe('booking canonical customer', () => {
  it.each([
    { partyId: 'pt-1', crmContactId: undefined, reads: [[{ id: 'pt-1' }], []] },
    {
      partyId: undefined,
      crmContactId: 'c-1',
      reads: [[{ id: 'c-1', partyId: 'pt-1' }], [{ id: 'pt-1' }]],
    },
  ])(
    'persists canonical party from explicit customer $partyId/$crmContactId',
    async ({ partyId, crmContactId, reads }) => {
      const { db, resolveSequence } = createMockDb();
      const insert = db.insert(schedBookings);
      const values = vi.fn((row: typeof schedBookings.$inferInsert) => insert.values(row));
      vi.mocked(db.insert).mockReturnValueOnce({ values } as never);
      resolveSequence(occurrence({ ...bookingRow('b-1'), partyId: 'pt-1' }, reads));
      await createBooking(ctx(db), { eventTypeId: 'et-1', start, partyId, crmContactId });
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ partyId: 'pt-1' }));
    },
  );

  it.each([
    {
      partyId: 'foreign',
      crmContactId: undefined,
      reads: [[]],
      code: 'booking_customer_not_found',
    },
    {
      partyId: undefined,
      crmContactId: 'foreign',
      reads: [[]],
      code: 'booking_customer_not_found',
    },
    {
      partyId: 'pt-1',
      crmContactId: 'c-2',
      reads: [[{ id: 'c-2', partyId: 'pt-2' }]],
      code: 'booking_customer_mismatch',
    },
  ])(
    'rejects invalid explicit customer $partyId/$crmContactId',
    async ({ partyId, crmContactId, reads, code }) => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence(occurrence(bookingRow('b-1'), reads));
      await expect(
        createBooking(ctx(db), { eventTypeId: 'et-1', start, partyId, crmContactId }),
      ).rejects.toMatchObject({ code });
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it('rejects a UID retry that belongs to another customer', async () => {
    const { db, resolveSequence } = createMockDb();
    const reads = occurrence(bookingRow('unused'));
    reads.splice(-2, 2, [], [{ ...bookingRow('other'), partyId: 'pt-other' }]);
    resolveSequence(reads);
    await expect(
      createBooking(ctx(db), { eventTypeId: 'et-1', start, uid: 'existing-uid' }),
    ).rejects.toMatchObject({ code: 'booking_retry_mismatch' });
  });
});

describe('bookAndLinkTicketLine', () => {
  it('books and stamps the line in ONE transaction, then accrues post-commit', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble(), [et], ...occurrence(bookingRow('b-1')), [{ id: 'ln-1' }]]);

    const out = await bookAndLinkTicketLine(ctx(db), input);

    expect(out).toMatchObject({ created: true, booking: { id: 'b-1' } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(accrueMock).toHaveBeenCalledTimes(1); // post-commit, fail-soft
  });

  it('a failing line claim rolls the booking back — ONE transaction, nothing post-commit', async () => {
    const { db, resolveSequence } = createMockDb();
    // The guarded `is null` update matches nothing: another cashier won the line
    // between the read and the write.
    resolveSequence([...preamble(), [et], ...occurrence(bookingRow('b-1')), []]);

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

  it('a cancelled booking is replaced without deleting its history', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      ...preamble({ bookingId: 'b-1' }),
      [bookingRow('b-1', 'cancelled')],
      [et],
      ...occurrence(bookingRow('b-2')),
      [{ id: 'ln-1' }],
      [],
    ]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).resolves.toMatchObject({
      created: true,
      booking: { id: 'b-2' },
    });
    expect(db.delete).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        refType: 'pos_ticket',
        refId: 'tk-1',
        changes: [
          { field: 'lines.ln-1.bookingId', label: 'Service appointment', old: 'b-1', new: 'b-2' },
        ],
      }),
    );
  });

  it('rejects substituting another sold service', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble(), [{ ...et, productId: 'other-product' }]]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'booking_product_mismatch',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects substituting another ticket customer', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble({ partyId: 'pt-1' }), [et]]);
    await expect(
      bookAndLinkTicketLine(ctx(db), { ...input, partyId: 'pt-2' }),
    ).rejects.toMatchObject({ code: 'booking_customer_mismatch' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not schedule instalments as treatments', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([...preamble({ planId: 'plan-1' })]);
    await expect(bookAndLinkTicketLine(ctx(db), input)).rejects.toMatchObject({
      code: 'line_not_service',
    });
  });

  it('cannot reuse a cancelled UID as its own replacement', async () => {
    const { db, resolveSequence } = createMockDb();
    const reads = occurrence(bookingRow('unused'));
    reads.splice(-2, 2, [], [bookingRow('b-1', 'cancelled')]);
    resolveSequence([
      ...preamble({ bookingId: 'b-1' }),
      [bookingRow('b-1', 'cancelled')],
      [et],
      ...reads,
    ]);
    await expect(
      bookAndLinkTicketLine(ctx(db), { ...input, uid: 'cancelled-uid' }),
    ).rejects.toMatchObject({ code: 'booking_retry_mismatch' });
    expect(db.update).not.toHaveBeenCalled();
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
    resolveSequence([...preamble(), [et], ...occurrence(bookingRow('b-1')), [{ id: 'ln-1' }]]);
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
      [et],
      [{ phone9: '987654321' }], // parties lookup
      ...occurrence({ ...bookingRow('b-1'), partyId: 'pt-1' }, [[{ id: 'pt-1' }], []]),
      [{ id: 'ln-1' }],
    ]);

    const out = await bookAndLinkTicketLine(ctx(db), input);

    expect(out.booking.id).toBe('b-1');
    expect(db.insert).toHaveBeenCalledWith(schedBookings);
  });
});
