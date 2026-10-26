import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  requireOrgCapability: vi.fn(),
  createDoor: vi.fn(),
  listDoorsWithFunnel: vi.fn(),
  getDoor: vi.fn(),
  updateDoor: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/inbox/daily-feed.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/services/inbox/daily-feed.service')>()),
  resolveOrgTimezone: async () => 'America/Lima',
}));
vi.mock('$server/services/doors.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/services/doors.service')>()),
  createDoor: mocks.createDoor,
  listDoorsWithFunnel: mocks.listDoorsWithFunnel,
  getDoor: mocks.getDoor,
  updateDoor: mocks.updateDoor,
}));

import { GET as list, POST as create } from './+server';
import { GET as read, PATCH as patch } from './[id]/+server';
import { DoorError } from '$server/services/doors.service';

const ID = '11111111-2222-4333-8444-555555555555';
const req = (body: unknown) =>
  new Request('http://hub.test/api/crm/doors', { method: 'POST', body: JSON.stringify(body) });
const status = async (p: unknown) =>
  Promise.resolve(p).then(
    (r) => (r as Response).status,
    (e: { status?: number }) => e.status,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1', profileId: 'p1' });
  mocks.requireOrgCapability.mockResolvedValue(null);
});

describe('/api/crm/doors', () => {
  it('401 without a tenant context', async () => {
    mocks.getCoreCtx.mockResolvedValue(null);
    expect(
      await status(list({ locals: {}, url: new URL('http://hub.test/api/crm/doors') } as never)),
    ).toBe(401);
  });

  it('GET needs crm:view and returns the funnel for the default 30 days', async () => {
    mocks.listDoorsWithFunnel.mockResolvedValue([]);
    const res = await list({ locals: {}, url: new URL('http://hub.test/api/crm/doors') } as never);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'view');
    expect((await res.json()).range.days).toBe(30);
  });

  it('POST needs crm:manage — a manager gets 403 and nothing is created', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      throw error(403, 'crm: manage required');
    });
    expect(
      await status(
        create({ locals: {}, request: req({ kind: 'form', slug: 'abc', title: 'x' }) } as never),
      ),
    ).toBe(403);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'manage');
    expect(mocks.createDoor).not.toHaveBeenCalled();
  });

  it('POST validates the slug (400) and maps slug_taken (409) / unknown_kind (400)', async () => {
    expect(
      await status(
        create({ locals: {}, request: req({ kind: 'form', slug: 'A!', title: 'x' }) } as never),
      ),
    ).toBe(400);
    mocks.createDoor.mockRejectedValueOnce(new DoorError('slug_taken', 409));
    const taken = await create({
      locals: {},
      request: req({ kind: 'form', slug: 'abc', title: 'x' }),
    } as never);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'slug_taken' });
    mocks.createDoor.mockRejectedValueOnce(new DoorError('unknown_kind', 400));
    expect(
      await status(
        create({ locals: {}, request: req({ kind: 'faq', slug: 'abc', title: 'x' }) } as never),
      ),
    ).toBe(400);
  });

  it('POST creates with the caller as creator → 201', async () => {
    mocks.createDoor.mockResolvedValue({ id: ID });
    const res = await create({
      locals: {},
      request: req({ kind: 'form', slug: 'qa-intake', title: ' Ficha ' }),
    } as never);
    expect(res.status).toBe(201);
    expect(mocks.createDoor).toHaveBeenCalledWith(expect.anything(), {
      kind: 'form',
      slug: 'qa-intake',
      title: 'Ficha',
      createdBy: 'p1',
    });
  });
});

describe('/api/crm/doors/[id]', () => {
  it('404s a non-uuid id before any work, and an unknown door', async () => {
    expect(await status(read({ locals: {}, params: { id: 'audit-door' } } as never))).toBe(404);
    mocks.getDoor.mockResolvedValue(null);
    expect(await status(read({ locals: {}, params: { id: ID } } as never))).toBe(404);
  });

  it('PATCH needs crm:manage and rejects unknown fields', async () => {
    mocks.requireOrgCapability.mockImplementationOnce(async () => {
      throw error(403, 'crm: manage required');
    });
    expect(
      await status(
        patch({ locals: {}, params: { id: ID }, request: req({ active: true }) } as never),
      ),
    ).toBe(403);
    expect(
      await status(
        patch({ locals: {}, params: { id: ID }, request: req({ orgId: 'x' }) } as never),
      ),
    ).toBe(400);
    expect(mocks.updateDoor).not.toHaveBeenCalled();
  });

  it('PATCH returns invalid_config issues as 400', async () => {
    mocks.updateDoor.mockRejectedValue(
      new DoorError('invalid_config', 400, [{ path: ['fields'] }]),
    );
    const res = await patch({
      locals: {},
      params: { id: ID },
      request: req({ config: {} }),
    } as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_config', issues: [{ path: ['fields'] }] });
  });

  it('PATCH toggles a door', async () => {
    mocks.updateDoor.mockResolvedValue({ id: ID, active: true });
    const res = await patch({
      locals: {},
      params: { id: ID },
      request: req({ active: true }),
    } as never);
    expect(res.status).toBe(200);
    expect(mocks.updateDoor).toHaveBeenCalledWith(expect.anything(), ID, {
      active: true,
      description: undefined,
    });
  });
});
