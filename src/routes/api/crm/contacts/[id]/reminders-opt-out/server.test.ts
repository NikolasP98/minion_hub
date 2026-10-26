import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  getContact: vi.fn(),
  setContactCustomField: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_c: unknown, fn: (tx: unknown) => unknown) => fn('tx'),
}));
vi.mock('$server/services/rbac.service', () => ({ ownerFilter: mocks.ownerFilter }));
vi.mock('$server/services/crm-contacts.service', () => ({
  getContact: mocks.getContact,
  setContactCustomField: mocks.setContactCustomField,
}));

import { PUT } from './+server';

const call = (body: unknown) =>
  PUT({
    locals: {},
    params: { id: 'c1' },
    request: new Request('http://hub.test/x', { method: 'PUT', body: JSON.stringify(body) }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1' });
  mocks.ownerFilter.mockResolvedValue(undefined);
  mocks.setContactCustomField.mockResolvedValue(true);
});

describe('PUT /api/crm/contacts/[id]/reminders-opt-out', () => {
  it('writes the reserved key as a boolean', async () => {
    const res = await call({ optOut: true });
    expect(res.status).toBe(200);
    expect(mocks.setContactCustomField).toHaveBeenCalledWith(
      'tx',
      'org-1',
      'c1',
      '_reminders_opt_out',
      true,
    );
  });
  it('404s for an unknown contact and 400s for a bad body', async () => {
    mocks.setContactCustomField.mockResolvedValue(false);
    await expect(call({ optOut: false })).rejects.toMatchObject({ status: 404 });
    await expect(call({ optOut: 'yes' })).rejects.toMatchObject({ status: 400 });
  });
});
