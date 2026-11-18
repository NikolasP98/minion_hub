import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  applyTag: vi.fn(),
  removeTag: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/crm-contacts.service', () => ({
  applyTag: mocks.applyTag,
  removeTag: mocks.removeTag,
}));

import { POST, DELETE } from './+server';

const TAG = '40000000-0000-4000-8000-000000000001';
const post = (body: unknown) =>
  POST({
    locals: { user: { supabaseId: 'u1' } },
    params: { id: 'c1' },
    request: new Request('https://hub.example.test/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);
const del = (tagId?: string) =>
  DELETE({
    locals: {},
    params: { id: 'c1' },
    url: new URL(`https://hub.example.test/x${tagId ? `?tagId=${tagId}` : ''}`),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
});

describe('/api/crm/contacts/[id]/tags', () => {
  it('201 on apply and 200 on remove', async () => {
    expect((await post({ tagId: TAG })).status).toBe(201);
    expect((await del(TAG)).status).toBe(200);
  });
  it('rejects a malformed tagId with 400 before the service', async () => {
    await expect(post({ tagId: 'not-a-uuid' })).rejects.toMatchObject({ status: 400 });
    await expect(del('not-a-uuid')).rejects.toMatchObject({ status: 400 });
    await expect(del()).rejects.toMatchObject({ status: 400 });
    expect(mocks.applyTag).not.toHaveBeenCalled();
    expect(mocks.removeTag).not.toHaveBeenCalled();
  });
  it('passes the 404 through and never forwards database text', async () => {
    mocks.applyTag.mockImplementationOnce(async () => {
      throw error(404, 'Contact not found');
    });
    await expect(post({ tagId: TAG })).rejects.toMatchObject({
      status: 404,
      body: { message: 'Contact not found' },
    });
    mocks.applyTag.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    const err = await Promise.resolve(post({ tagId: TAG })).catch((e: unknown) => e);
    expect(JSON.stringify(err)).not.toContain('invalid input syntax');
  });
});
