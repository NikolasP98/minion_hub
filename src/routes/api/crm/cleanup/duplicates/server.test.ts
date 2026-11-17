import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  shouldMask: vi.fn(),
  mergeContacts: vi.fn(),
  findDuplicates: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: mocks.ownerFilter,
  shouldMaskSensitive: mocks.shouldMask,
}));
vi.mock('$server/services/crm-cleanup.service', () => ({
  mergeContacts: mocks.mergeContacts,
  findDuplicates: mocks.findDuplicates,
}));

import { GET, POST } from './+server';

const post = (body: unknown) =>
  POST({
    locals: {},
    request: new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.ownerFilter.mockResolvedValue(undefined);
  mocks.shouldMask.mockResolvedValue(false);
});

describe('/api/crm/cleanup/duplicates', () => {
  it('GET is never cached', async () => {
    mocks.findDuplicates.mockResolvedValue([]);
    const res = await GET({ locals: {} } as never);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
  it('POST derives the options on the server and acknowledges {ok:true}', async () => {
    mocks.shouldMask.mockResolvedValue(true);
    mocks.ownerFilter.mockResolvedValue('p1');
    const res = await post({
      survivorId: 's',
      loserIds: ['l'],
      options: { canWriteSensitiveFields: true },
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.mergeContacts).toHaveBeenCalledWith({ tenantId: 'org-1' }, 's', ['l'], undefined, {
      canWriteSensitiveFields: false,
      ownerId: 'p1',
    });
  });
  it.each([
    [403, 'sensitive_fields_restricted'],
    [404, 'Contact not found'],
  ])('passes the %s refusal through', async (status, message) => {
    mocks.mergeContacts.mockImplementation(async () => {
      throw error(status, message);
    });
    await expect(post({ survivorId: 's', loserIds: ['l'] })).rejects.toMatchObject({
      status,
      body: { message },
    });
  });
});
