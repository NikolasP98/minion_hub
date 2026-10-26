import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  requireOrgCapability: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  getDoor: vi.fn(),
  getChannelCatalog: vi.fn(),
  getFollowUpActivity: vi.fn(),
  setFollowUp: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
  shouldMaskSensitive: mocks.shouldMaskSensitive,
}));
vi.mock('$server/services/doors.service', () => ({ getDoor: mocks.getDoor }));
vi.mock('$server/services/crm-channels.service', () => ({
  getChannelCatalog: mocks.getChannelCatalog,
}));
vi.mock('$server/services/doors-followup.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/services/doors-followup.service')>()),
  getFollowUpActivity: mocks.getFollowUpActivity,
  setFollowUp: mocks.setFollowUp,
}));

import { GET, PUT } from './+server';

const ID = '11111111-2222-4333-8444-555555555555';
const body = { enabled: true, delayMinutes: 30, accountId: 'acct-1', template: 'Hola {nombre}' };
const put = (b: unknown) =>
  PUT({
    locals: {},
    params: { id: ID },
    request: new Request('http://hub.test/x', { method: 'PUT', body: JSON.stringify(b) }),
  } as never);
const status = async (p: unknown) =>
  Promise.resolve(p).then(
    (r) => (r as Response).status,
    (e: { status?: number }) => e.status,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.getDoor.mockResolvedValue({ id: ID, kind: 'form', followUp: null });
  mocks.getChannelCatalog.mockResolvedValue({
    accounts: [
      { channel: 'whatsapp', accountId: 'acct-1', name: 'FACES', phone: '+51999', enabled: true },
      { channel: 'telegram', accountId: 'acct-tg', name: 'TG', phone: null, enabled: true },
    ],
    defaults: {},
  });
  mocks.setFollowUp.mockImplementation(async (_c: unknown, _id: string, f: object) => ({
    ...f,
    enabledAt: '2026-10-25T12:00:00Z',
  }));
  mocks.getFollowUpActivity.mockResolvedValue({
    counts: { sent: 1, failed: 0, skipped: 0 },
    rows: [{ id: 'r1', recipient: '+51900000041' }],
  });
});

describe('PUT /api/crm/doors/[id]/follow-up', () => {
  it('a manager (no crm:manage) gets 403 and nothing is written', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      throw error(403, 'crm: manage required');
    });
    expect(await status(put(body))).toBe(403);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'manage');
    expect(mocks.setFollowUp).not.toHaveBeenCalled();
  });

  it('an account outside the org catalog (or not WhatsApp) is 400 account_not_available', async () => {
    for (const accountId of ['acct-of-another-org', 'acct-tg']) {
      const res = (await put({ ...body, accountId })) as Response;
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'account_not_available' });
    }
    expect(mocks.setFollowUp).not.toHaveBeenCalled();
  });

  it('a delay under 15 minutes is 400', async () => {
    expect(await status(put({ ...body, delayMinutes: 10 }))).toBe(400);
  });

  it('enabling with the gateway down is 503; disabling never needs the gateway', async () => {
    mocks.getChannelCatalog.mockResolvedValue(null);
    expect(await status(put(body))).toBe(503);
    expect(await status(put({ ...body, enabled: false, accountId: '' }))).toBe(200);
    expect(mocks.setFollowUp).toHaveBeenCalledTimes(1);
  });

  it('only form doors take a follow-up', async () => {
    mocks.getDoor.mockResolvedValue({ id: ID, kind: 'faq', followUp: null });
    expect(await status(put(body))).toBe(400);
  });

  it('saves a valid follow-up', async () => {
    const res = (await put(body)) as Response;
    expect(res.status).toBe(200);
    expect(mocks.setFollowUp).toHaveBeenCalledWith({ tenantId: 'org-1' }, ID, body);
  });
});

describe('GET /api/crm/doors/[id]/follow-up', () => {
  const get = () => GET({ locals: {}, params: { id: ID } } as never);

  it('needs crm:manage (form submissions are owner/admin only)', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      throw error(403, 'crm: manage required');
    });
    expect(await status(get())).toBe(403);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'manage');
  });

  it('lists only WhatsApp accounts and masks recipients below the sensitive field level', async () => {
    mocks.shouldMaskSensitive.mockResolvedValue(true);
    const data = await ((await get()) as Response).json();
    expect(data.accounts).toEqual([{ accountId: 'acct-1', name: 'FACES', phone: '+51999' }]);
    expect(data.rows[0].recipient).not.toContain('900000');
    expect(data.counts.sent).toBe(1);
  });
});
