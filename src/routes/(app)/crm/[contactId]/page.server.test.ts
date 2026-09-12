import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every service the loader fans out to, before importing the module.
const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  getContact: vi.fn(),
  listBookings: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: (l: unknown) => mocks.getCoreCtx(l) }));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: (l: unknown, m: unknown) => mocks.ownerFilter(l, m),
  shouldMaskSensitive: (l: unknown, m: unknown) => mocks.shouldMaskSensitive(l, m),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  getContact: (...args: unknown[]) => mocks.getContact(...args),
  getContactTimeline: vi.fn(async () => []),
  getContactTags: vi.fn(async () => []),
  listTags: vi.fn(async () => []),
  rankContacts: vi.fn(async () => []),
}));
vi.mock('$server/services/crm-scoring', () => ({ evaluateTagRule: vi.fn(() => false) }));
vi.mock('$server/services/crm-finance.service', () => ({
  contactFinanceSummary: vi.fn(async () => null),
  contactCashflow: vi.fn(async () => null),
}));
vi.mock('$server/services/connections.service', () => ({
  contactConnections: vi.fn(async () => []),
}));
vi.mock('$server/services/crm-journey.service', () => ({ contactJourney: vi.fn(async () => []) }));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  listBookings: (...args: unknown[]) => mocks.listBookings(...args),
}));

const { load } = await import('./+page.server');

const CTX = { db: {}, tenantId: 'org-1' };
const CONTACT_ID = '11111111-1111-1111-1111-111111111111';

function event() {
  return {
    locals: {},
    params: { contactId: CONTACT_ID },
    depends: vi.fn(),
    parent: vi.fn(async () => ({ activeOrgKind: 'business' })),
  } as never;
}

describe('crm contact detail loader — bookings fan-out (S10)', () => {
  beforeEach(() => {
    mocks.getCoreCtx.mockResolvedValue(CTX);
    mocks.ownerFilter.mockResolvedValue(null);
    // 'scheduling' → masked, everything else unmasked (distinguishes the two
    // shouldMaskSensitive() calls the loader now makes).
    mocks.shouldMaskSensitive.mockImplementation(
      async (_l: unknown, m: string) => m === 'scheduling',
    );
    mocks.getContact.mockResolvedValue({
      contact: { id: CONTACT_ID, displayName: 'Ana', customFields: {}, source: 'manual' },
      identities: [],
      stats: {},
      party: null,
    });
    mocks.listBookings.mockReset().mockResolvedValue([]);
  });

  it('passes crmContactId + scheduling PII masking to listBookings and returns its rows', async () => {
    const row = { id: 'bk-1', title: 'Consulta', startTime: new Date(), status: 'accepted' };
    mocks.listBookings.mockResolvedValueOnce([row]);

    const data = (await load(event())) as Record<string, unknown>;

    expect(mocks.listBookings).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ crmContactId: CONTACT_ID, limit: 20, maskAttendeePii: true }),
    );
    expect(data.bookings).toEqual([row]);
  });

  it('degrades to an empty list when scheduling is disabled/absent for the org', async () => {
    mocks.listBookings.mockRejectedValueOnce(new Error('relation "sched_bookings" missing'));

    const data = (await load(event())) as Record<string, unknown>;

    expect(data.bookings).toEqual([]);
  });
});
