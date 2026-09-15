import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

/**
 * Slice S2 of spec 2026-09-13-pos-scheduling-packages-payment-plans-spec.md:
 * what `submitTicket` / `voidTicket` do once packages, instalment plans and
 * client credit exist. The pure allocation/balance/expiry math is covered by
 * pos-accounts.logic.test.ts — this file only asserts the WIRING.
 *
 * Mocked at exactly the level pos.tickets.test.ts mocks: the stock engine and
 * the module registry, so the money path runs against the sequential mock db.
 */

const { MockStockError } = vi.hoisted(() => ({
  MockStockError: class MockStockError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'StockError';
      this.code = code;
    }
  },
}));
vi.mock('./stock.service', () => ({
  createSourcedIssue: vi.fn(),
  findEntryBySource: vi.fn(async () => null),
  submitEntry: vi.fn(),
  cancelEntry: vi.fn(),
  StockError: MockStockError,
  listAllComponentEdges: vi.fn(async () => []),
}));
vi.mock('./stock-accruals.service', () => ({ resolveDefaultWarehouse: vi.fn(async () => null) }));
// Stock OFF: the post-commit stock hook is pos.tickets.test.ts's subject, and
// skipping it keeps every sequence below the money path and nothing else.
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => false }));

// The grant minter is exercised for its INPUT here; that the allocation it
// receives is the right one is asserted through the real `allocateGrants`.
const createGrantsMock =
  vi.fn<(tx: unknown, orgId: string, input: PackageInput) => Promise<unknown[]>>();
const reverseRedemptionMock =
  vi.fn<(tx: unknown, orgId: string, id: string, opts: unknown) => Promise<unknown>>();
vi.mock('./pos-packages.service', () => ({
  createGrantsForTicketLine: (tx: unknown, orgId: string, input: PackageInput) =>
    createGrantsMock(tx, orgId, input),
  reverseRedemptionInTx: (tx: unknown, orgId: string, id: string, opts: unknown) =>
    reverseRedemptionMock(tx, orgId, id, opts),
}));

import { posPackageGrants, posPackageRedemptions, posPaymentPlans } from '$server/db/pg-pos-schema';
import { allocateGrants, expiryFrom, grantToday } from './pos-accounts.logic';
import { submitTicket, voidTicket, type SubmitTicketInput } from './pos.service';

interface PackageInput {
  line: { ticketId: string; lineId: string; packageProductId: string; qty: number; total: number };
  edges: { childProductId: string; qty: number }[];
  client: { partyId?: string | null; crmContactId?: string | null };
  expiresAt?: string | null;
}

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };
const openShiftRow = { id: 'shift-1', orgId: 'org-1', status: 'open', openingFloat: {} };

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    orgId: 'org-1',
    humanId: 'POS-2026-00001',
    shiftId: 'shift-1',
    partyId: 'party-1',
    crmContactId: null,
    status: 'submitted',
    subtotal: '20',
    discount: '0',
    total: '20',
    currency: 'PEN',
    stockEntryId: null,
    stockWarning: null,
    invoiceProviderRef: null,
    ...overrides,
  };
}

/** nextSerialId reads `{n}` back off tx.execute; every other execute ignores it. */
function mockExecute(db: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue([{ n: 1 }]);
}

/** Which drizzle tables a run wrote to — the mock records the table arg. */
function updatedTables(db: unknown): unknown[] {
  return (db as { update: { mock: { calls: unknown[][] } } }).update.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  createGrantsMock.mockResolvedValue([]);
  reverseRedemptionMock.mockResolvedValue({});
});

describe('submitTicket — selling a package', () => {
  it('mints grants for the bundle line, with the sessions and per-session value the line bought', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [], // pos settings (defaults)
      [
        {
          bundleProductId: 'pkg-1',
          childProductId: 'svc-1',
          qty: '3',
          metadata: { packageValidityDays: 90 },
        },
      ], // fin_product_components + package metadata
      [], // fin settings (defaults → America/Lima)
      [openShiftRow],
      [ticketRow({ subtotal: '1200', total: '1200' })], // insert ticket returning
      [{ id: 'line-1', lineNo: 0 }], // insert lines returning
      [], // insert payments
    ]);

    const input: SubmitTicketInput = {
      lines: [
        {
          kind: 'service',
          finProductId: 'pkg-1',
          description: 'Paquete 3 sesiones',
          qty: 2,
          unitPrice: 600,
        },
      ],
      payments: [{ method: 'cash', amount: 1200, tendered: 1200 }],
      partyId: 'party-1',
      actor,
    };
    await submitTicket(ctx(db), input);

    expect(createGrantsMock).toHaveBeenCalledTimes(1);
    const [, orgId, arg] = createGrantsMock.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(arg.line).toEqual({
      ticketId: 'ticket-1',
      lineId: 'line-1',
      packageProductId: 'pkg-1',
      qty: 2,
      total: 1200,
    });
    expect(arg.client).toEqual({ partyId: 'party-1', crmContactId: null });
    expect(arg.expiresAt).toBe(expiryFrom(grantToday('America/Lima'), 90));
    // 2 × a 3-session package = 6 sessions, and the 1200 the line took is spread
    // across all six — Σ(unitValue × sessionsTotal) === line total.
    expect(allocateGrants(arg.line.total, arg.line.qty, arg.edges)).toEqual([
      { childProductId: 'svc-1', sessionsTotal: 6, unitValue: 200 },
    ]);
  });

  it('refuses an anonymous package sale — a grant nobody owns is unredeemable', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // settings
      [{ bundleProductId: 'pkg-1', childProductId: 'svc-1', qty: '3', metadata: {} }],
    ]);
    const input: SubmitTicketInput = {
      lines: [
        { kind: 'service', finProductId: 'pkg-1', description: 'Paquete', qty: 1, unitPrice: 600 },
      ],
      payments: [{ method: 'cash', amount: 600, tendered: 600 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({
      code: 'package_requires_customer',
    });
    expect(createGrantsMock).not.toHaveBeenCalled();
  });
});

describe('submitTicket — billing a drawn session', () => {
  const sessionLine: SubmitTicketInput = {
    lines: [
      {
        kind: 'service',
        finProductId: 'svc-1',
        description: 'Sesión de paquete',
        qty: 1,
        unitPrice: 0,
        redemptionId: 'red-1',
      },
    ],
    payments: [],
    partyId: 'party-1',
    actor,
  };

  it('back-links the redemption to the line that billed it', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [], // settings
      [], // fin_product_components — svc-1 is not a package
      [{ id: 'red-1', ticketId: null }], // redemption usability
      [openShiftRow],
      [ticketRow({ subtotal: '0', total: '0' })],
      [{ id: 'line-1', lineNo: 0 }],
      [{ id: 'red-1' }], // the stamp claim succeeds
    ]);
    const { ticket } = await submitTicket(ctx(db), sessionLine);
    expect(ticket.id).toBe('ticket-1');
    expect(updatedTables(db)).toContain(posPackageRedemptions);
  });

  it('409s when the session already carries a ticket', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [],
      [],
      [{ id: 'red-1', ticketId: 'ticket-9' }], // billed on an earlier ticket
    ]);
    await expect(submitTicket(ctx(db), sessionLine)).rejects.toMatchObject({
      code: 'redemption_already_billed',
    });
  });

  it('409s when a concurrent ticket claims the session first', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [],
      [],
      [{ id: 'red-1', ticketId: null }], // clean at the early check…
      [openShiftRow],
      [ticketRow({ subtotal: '0', total: '0' })],
      [{ id: 'line-1', lineNo: 0 }],
      [], // …but the conditional UPDATE claims nothing: someone else won
    ]);
    await expect(submitTicket(ctx(db), sessionLine)).rejects.toMatchObject({
      code: 'redemption_already_billed',
    });
  });
});

describe('submitTicket — instalment plans', () => {
  const planLine = (amount: number): SubmitTicketInput => ({
    lines: [
      {
        kind: 'service',
        description: 'Cuota tratamiento',
        qty: 1,
        unitPrice: amount,
        planId: 'plan-1',
      },
    ],
    payments: [{ method: 'cash', amount, tendered: amount }],
    partyId: 'party-1',
    actor,
  });

  it('leaves the plan open while its lines do not cover the total', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [], // settings
      [{ id: 'plan-1', status: 'open' }], // plan usability check
      [openShiftRow],
      [ticketRow({ subtotal: '100', total: '100' })],
      [{ id: 'line-1', lineNo: 0 }],
      [], // payments
      [{ id: 'plan-1', status: 'open', totalAmount: '200' }], // settlePlanIfPaid: load
      [{ total: '100' }], // paid lines over non-void tickets
    ]);
    await submitTicket(ctx(db), planLine(100));
    expect(updatedTables(db)).not.toContain(posPaymentPlans);
  });

  it('settles the plan on the instalment that completes it', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [], // settings
      [{ id: 'plan-1', status: 'open' }],
      [openShiftRow],
      [ticketRow({ id: 'ticket-2', subtotal: '100', total: '100' })],
      [{ id: 'line-2', lineNo: 0 }],
      [], // payments
      [{ id: 'plan-1', status: 'open', totalAmount: '200' }],
      [{ total: '100' }, { total: '100' }], // both instalments now counted
      [{ id: 'plan-1', status: 'settled' }], // update returning
    ]);
    await submitTicket(ctx(db), planLine(100));
    expect(updatedTables(db)).toContain(posPaymentPlans);
  });

  it('rejects a line pointing at a plan that is not this org’s', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // settings, plan lookup finds nothing
    await expect(submitTicket(ctx(db), planLine(100))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('submitTicket — credit tender', () => {
  const settingsRow = {
    methods: [
      { id: 'credit', label: 'Crédito', enabled: true, takesTendered: false },
      { id: 'cash', label: 'Efectivo', enabled: true, takesTendered: true },
    ],
    currency: 'PEN',
    requireCustomer: false,
    allowPriceOverride: true,
    emission: { mode: 'off', docTypeDefault: '03' },
  };
  const creditInput: SubmitTicketInput = {
    lines: [{ kind: 'product', description: 'Crema', qty: 1, unitPrice: 50 }],
    payments: [{ method: 'credit', amount: 50 }],
    partyId: 'party-1',
    actor,
  };

  it('409s with insufficient_credit when the balance cannot cover the tender', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [settingsRow],
      [openShiftRow],
      [ticketRow({ subtotal: '50', total: '50' })],
      [{ id: 'line-1', lineNo: 0 }],
      [], // payments
      [{ amount: '10' }], // client ledger — 10 of stored value against a 50 tender
    ]);
    await expect(submitTicket(ctx(db), creditInput)).rejects.toMatchObject({
      code: 'insufficient_credit',
    });
  });

  it('writes one negative ledger row when the balance covers it', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db);
    resolveSequence([
      [settingsRow],
      [openShiftRow],
      [ticketRow({ subtotal: '50', total: '50' })],
      [{ id: 'line-1', lineNo: 0 }],
      [], // payments
      [{ amount: '120' }], // balance covers it
      [{ id: 'ledger-1' }], // the negative ledger row
    ]);
    const { ticket } = await submitTicket(ctx(db), creditInput);
    expect(ticket.id).toBe('ticket-1');
  });

  it('refuses credit without an identified client', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[settingsRow]]);
    await expect(submitTicket(ctx(db), { ...creditInput, partyId: null })).rejects.toMatchObject({
      code: 'client_required',
    });
  });
});

describe('voidTicket — undoing a package sale', () => {
  it('cancels the grants the ticket minted and reverses its redemptions', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't5' })], // loadTicketRow
      [{ status: 'open' }], // shift
      [{ id: 'red-1', bookingId: null, reversedAt: null }], // drawn AT THE TILL by this ticket
      [{ id: 'grant-1' }], // grants minted by this ticket
      [], // no OTHER live redemption against those grants
      [], // clear the ticket stamp
      [], // cancel grants update
      [], // client-ledger rows to reverse
      [ticketRow({ id: 't5', status: 'void' })], // update returning
    ]);
    const result = await voidTicket(ctx(db), 't5', actor);
    expect(reverseRedemptionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'red-1',
      expect.objectContaining({ reason: 'void of POS-2026-00001' }),
    );
    expect(updatedTables(db)).toContain(posPackageGrants);
    expect(result.status).toBe('void');
  });

  it('un-bills a session drawn at BOOKING time instead of handing it back', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't8' })],
      [{ status: 'open' }],
      // Drawn when the appointment was booked; this ticket only BILLED it.
      [{ id: 'red-2', bookingId: 'booking-1', reversedAt: null }],
      [], // this ticket minted no grants
      [], // clear the ticket stamp
      [], // client-ledger rows
      [ticketRow({ id: 't8', status: 'void' })],
    ]);
    const result = await voidTicket(ctx(db), 't8', actor);
    // The appointment still stands, so the session stays drawn — only the
    // ticket link is cleared, which is what lets a corrected ticket re-bill it.
    expect(reverseRedemptionMock).not.toHaveBeenCalled();
    expect(updatedTables(db)).toContain(posPackageRedemptions);
    expect(result.status).toBe('void');
  });

  it('409s with package_in_use when a session of the sold package is already booked', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't6' })],
      [{ status: 'open' }],
      [], // nothing redeemed on the ticket itself
      [{ id: 'grant-1' }], // it minted a grant
      [{ id: 'red-9' }], // …and a booking already drew a session from it
    ]);
    await expect(voidTicket(ctx(db), 't6', actor)).rejects.toMatchObject({
      code: 'package_in_use',
    });
    // Refused BEFORE any write — the grant is untouched.
    expect(updatedTables(db)).not.toContain(posPackageGrants);
  });

  it('writes an opposing ledger row for stored value the ticket consumed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't7' })],
      [{ status: 'open' }],
      [], // no redemptions
      [], // no grants
      [
        {
          id: 'ledger-1',
          partyId: 'party-1',
          crmContactId: null,
          amount: '-50',
          currency: 'PEN',
          planId: null,
          bookingId: null,
          metadata: {},
        },
      ],
      [{ id: 'ledger-2' }], // the opposing row
      [ticketRow({ id: 't7', status: 'void' })],
    ]);
    const result = await voidTicket(ctx(db), 't7', actor);
    expect(result.status).toBe('void');
    // insert targets: only the reversal row (grants/redemptions were empty).
    expect(
      (db as unknown as { insert: { mock: { calls: unknown[][] } } }).insert,
    ).toHaveBeenCalledTimes(1);
  });
});
