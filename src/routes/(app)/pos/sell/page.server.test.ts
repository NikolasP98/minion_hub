import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  listSellables: vi.fn(),
  listTickets: vi.fn(),
  listShifts: vi.fn(),
  listResources: vi.fn(),
  listEventTypes: vi.fn(),
  getBookingDetail: vi.fn(),
  getParty: vi.fn(),
  getContact: vi.fn(),
  requireOrgCapability: vi.fn(),
  shouldMaskSensitive: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/pos.service', () => ({
  listSellables: mocks.listSellables,
  listTickets: mocks.listTickets,
  listShifts: mocks.listShifts,
}));
vi.mock('$server/services/scheduling.service', () => ({
  listResources: mocks.listResources,
  listEventTypes: mocks.listEventTypes,
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  getBookingDetail: mocks.getBookingDetail,
}));
vi.mock('$server/services/party.service', () => ({ getParty: mocks.getParty }));
vi.mock('$server/services/crm-contacts.service', () => ({ getContact: mocks.getContact }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
  shouldMaskSensitive: mocks.shouldMaskSensitive,
}));
import { load } from './+page.server';

const id = '11111111-1111-4111-8111-111111111111';
const ctx = { tenantId: 'org', db: {} };
const detail = {
  booking: {
    id,
    status: 'accepted',
    productId: 'service',
    partyId: 'party',
    attendeeName: 'Old name',
    attendeePhone: 'Old phone',
  },
  eventType: null,
  grant: null,
  plan: null,
  tickets: [],
};
const run = (booking = id, timing = 'any_time') =>
  load({
    locals: { moduleStates: { scheduling: true } },
    depends: vi.fn(),
    url: new URL(`http://localhost/pos/sell?booking=${booking}`),
    parent: async () => ({ posSettings: { workflow: { appointmentPayment: timing } } }),
  } as unknown as Parameters<typeof load>[0]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCoreCtx.mockResolvedValue(ctx);
  mocks.listSellables.mockResolvedValue([{ productId: 'service' }]);
  for (const key of ['listTickets', 'listShifts', 'listResources', 'listEventTypes'] as const)
    mocks[key].mockResolvedValue([]);
  mocks.getBookingDetail.mockResolvedValue(detail);
  mocks.getParty.mockResolvedValue({
    id: 'party',
    name: 'Canonical name',
    phone9: '999888777',
    docNumber: '12345678',
  });
  mocks.shouldMaskSensitive.mockResolvedValue(false);
});

describe('booking checkout server load', () => {
  it('loads authoritative party identity and document within the org and read permission', async () => {
    const result = await run();
    expect(result?.bookingCheckout?.customer).toEqual({
      partyId: 'party',
      customerName: 'Canonical name',
      customerPhone: '999888777',
      customerDocNumber: '12345678',
    });
    expect(mocks.getBookingDetail).toHaveBeenCalledWith(ctx, id);
    expect(mocks.getParty).toHaveBeenCalledWith(ctx, 'party');
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(
      expect.anything(),
      'scheduling',
      'view',
    );
  });
  it('does not prefill missing or foreign bookings', async () => {
    mocks.getBookingDetail.mockResolvedValue(null);
    expect((await run())?.bookingCheckout).toBeNull();
    expect(mocks.getParty).not.toHaveBeenCalled();
  });
  it('resolves the canonical party for a legacy contact-linked booking', async () => {
    mocks.getBookingDetail.mockResolvedValue({
      ...detail,
      booking: { ...detail.booking, partyId: null, crmContactId: 'contact' },
    });
    mocks.getContact.mockResolvedValue({ contact: { partyId: 'party' } });
    expect((await run())?.bookingCheckout?.customer.customerDocNumber).toBe('12345678');
    expect(mocks.getContact).toHaveBeenCalledWith(ctx, 'contact');
  });
  it('does not prefill an already-paid appointment or bypass completion policy', async () => {
    expect((await run(id, 'after_completion'))?.bookingCheckoutUnavailable).toBe(true);
    mocks.getBookingDetail.mockResolvedValue({ ...detail, tickets: [{ status: 'submitted' }] });
    expect((await run())?.bookingCheckout).toBeNull();
  });
  it('retains field masking for identity details', async () => {
    mocks.shouldMaskSensitive.mockResolvedValue(true);
    const result = await run();
    expect(result?.bookingCheckout?.customer.customerDocNumber).toBe('••••5678');
    expect(result?.bookingCheckout?.customer.customerPhone).toBe('•••••8777');
  });
});
