import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  getCoreCtx: vi.fn(),
  softDeleteContacts: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  ROSTER_CAP: 50_000,
  softDeleteContacts: mocks.softDeleteContacts,
}));

import { POST } from './+server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.softDeleteContacts.mockResolvedValue(2);
});

it('requires delete permission and performs one service call for all ids', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const locals = {};
  const response = await POST({
    locals,
    request: new Request('https://hub.test/api/crm/contacts/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    }),
  } as never);

  expect(mocks.requireOrgCapability).toHaveBeenCalledWith(locals, 'crm', 'delete');
  expect(mocks.softDeleteContacts).toHaveBeenCalledWith(expect.anything(), ids);
  await expect(response.json()).resolves.toEqual({ ok: true, deleted: 2 });
});
