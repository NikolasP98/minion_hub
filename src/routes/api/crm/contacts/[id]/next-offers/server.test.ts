import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  requireOrgCapability: vi.fn(),
  getContact: vi.fn(),
  isModuleEnabled: vi.fn(),
  getNextOffers: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: mocks.ownerFilter,
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/crm-contacts.service', () => ({ getContact: mocks.getContact }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock('$server/services/crm-next-offers.service', () => ({
  getNextOffers: mocks.getNextOffers,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const ctx = { db: {}, tenantId: 'org-1' };
const call = async (id = ID) => {
  const { GET } = await import('./+server');
  return GET({ locals: {}, params: { id } } as Parameters<typeof GET>[0]);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue(ctx);
  mocks.ownerFilter.mockResolvedValue(undefined);
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.getContact.mockResolvedValue({ contact: { id: ID } });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.getNextOffers.mockResolvedValue({ bought: [], suggestions: [], topSellers: [] });
});

describe('GET /api/crm/contacts/[id]/next-offers', () => {
  it('404s a contact owned by someone else (owner-scoped lookup)', async () => {
    mocks.ownerFilter.mockResolvedValue('user-1');
    mocks.getContact.mockResolvedValue(null);
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(mocks.getContact).toHaveBeenCalledWith(ctx, ID, 'user-1');
    expect(mocks.getNextOffers).not.toHaveBeenCalled();
  });
  it('404s a malformed id without touching the database', async () => {
    await expect(call('nope')).rejects.toMatchObject({ status: 404 });
    expect(mocks.getContact).not.toHaveBeenCalled();
  });
  it('returns empty when pos is off', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);
    const res = await call();
    expect(await res.json()).toEqual({ bought: [], suggestions: [], topSellers: [] });
    expect(mocks.getNextOffers).not.toHaveBeenCalled();
  });
  it('returns the offers', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.getNextOffers).toHaveBeenCalledWith(ctx, ID);
  });
});
