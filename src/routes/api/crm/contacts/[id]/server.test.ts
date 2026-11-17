import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  shouldMask: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: async () => undefined,
  shouldMaskSensitive: mocks.shouldMask,
}));
vi.mock('$server/services/crm-contacts.service', async () => {
  const { StaleWriteError } = await import('$server/services/errors');
  void StaleWriteError;
  return {
    getContact: vi.fn(),
    getContactTimeline: vi.fn(),
    getContactTags: vi.fn(),
    updateContact: mocks.updateContact,
  };
});

import { PATCH } from './+server';
import { StaleWriteError } from '$server/services/errors';

const patch = (body: unknown) =>
  PATCH({
    locals: {},
    params: { id: 'c1' },
    request: new Request('http://localhost/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);
const row = { id: 'c1', customFields: { instagram_handle: 'synthetic_123', distrito: 'x' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
});

describe('PATCH /api/crm/contacts/[id] masked-field authority', () => {
  it.each([
    [true, false],
    [false, true],
  ])('masked=%s passes canWriteSensitiveFields=%s', async (masked, can) => {
    mocks.shouldMask.mockResolvedValue(masked);
    mocks.updateContact.mockResolvedValue(row);
    const res = await patch({ customFields: {}, canWriteSensitiveFields: true });
    expect(mocks.updateContact.mock.calls[0][4]).toEqual({ canWriteSensitiveFields: can });
    const { contact } = await res.json();
    expect(contact.customFields.instagram_handle).toBe(masked ? '••••••••_123' : 'synthetic_123');
  });
  it('a stale response never returns the raw masked value', async () => {
    mocks.shouldMask.mockResolvedValue(true);
    mocks.updateContact.mockRejectedValue(new StaleWriteError(row as never));
    const res = await patch({ expectedUpdatedAt: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(409);
    expect((await res.json()).current.customFields.instagram_handle).toBe('••••••••_123');
  });
});
