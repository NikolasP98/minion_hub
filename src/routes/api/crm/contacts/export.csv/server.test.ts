import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  getMetaKeys: vi.fn(),
  rankContactsPageCached: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
  ownerFilter: mocks.ownerFilter,
  shouldMaskSensitive: mocks.shouldMaskSensitive,
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  ROSTER_CAP: 50_000,
  getMetaKeys: mocks.getMetaKeys,
  rankContactsPageCached: mocks.rankContactsPageCached,
}));

import { GET } from './+server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.ownerFilter.mockResolvedValue(undefined);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.getMetaKeys.mockResolvedValue(['dni']);
  mocks.rankContactsPageCached.mockResolvedValue({
    rows: [
      {
        contact_id: 'c1',
        display_name: 'Ana, Maria',
        score: 88,
        stage: 'Active',
        funnel_stage: 'customer',
        dni_verified: true,
        sex: 'F',
        lead_origin: 'organic',
        finance: { revenue: 120, invoices: 2, lastPurchaseAt: '2026-08-20' },
        channels: ['whatsapp'],
        total_msgs: 7,
        inbound_msgs: 5,
        last_contact_at: '2026-08-21',
        custom_fields: { dni: '12345678' },
      },
    ],
    total: 1,
    hasMore: false,
    financeEnabled: true,
  });
});

const call = (search = '') =>
  GET({
    locals: { profile: { id: 'p1' } },
    url: new URL(`https://hub.test/api/crm/contacts/export.csv${search}`),
  } as never);

describe('GET /api/crm/contacts/export.csv', () => {
  it('enforces CRM export capability and exports every filtered row, not the visible page', async () => {
    const response = await call('?columns=name,score,meta:dni&stage=Active');
    const text = await response.text();

    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(expect.anything(), 'crm', 'export');
    expect(mocks.rankContactsPageCached).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: 'Active', limit: 50_000, offset: 0, includeTotal: true }),
    );
    expect(response.headers.get('content-disposition')).toContain('customers-');
    expect(text).toContain('Contact,Score,dni');
    expect(text).toContain('"Ana, Maria",88,12345678');
  });

  it('stops before any data read when CRM export capability is denied', async () => {
    mocks.requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(mocks.getCoreCtx).not.toHaveBeenCalled();
    expect(mocks.rankContactsPageCached).not.toHaveBeenCalled();
  });

  it('passes field masking into the ranked export query', async () => {
    mocks.shouldMaskSensitive.mockResolvedValueOnce(true);
    await call('?columns=name,meta:dni');
    expect(mocks.rankContactsPageCached).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maskSensitive: true }),
    );
  });

  it('rejects unknown-only column selections', async () => {
    await expect(call('?columns=password,secret')).rejects.toMatchObject({ status: 400 });
  });

  it('fails explicitly rather than silently truncating above the export safety limit', async () => {
    mocks.rankContactsPageCached.mockResolvedValueOnce({ rows: [], total: 50_001 });
    await expect(call()).rejects.toMatchObject({ status: 413 });
  });
});
