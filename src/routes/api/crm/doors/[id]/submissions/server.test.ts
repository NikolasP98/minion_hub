import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  requireOrgCapability: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  getDoor: vi.fn(),
  listSubmissions: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
  shouldMaskSensitive: mocks.shouldMaskSensitive,
}));
vi.mock('$server/services/doors.service', () => ({ getDoor: mocks.getDoor }));
vi.mock('$server/services/doors-form.service', () => ({ listSubmissions: mocks.listSubmissions }));

import { GET } from './+server';

const ID = '11111111-2222-4333-8444-555555555555';
const call = (query = '') =>
  Promise.resolve(
    GET({
      locals: {},
      params: { id: ID },
      url: new URL(`http://hub.test/api/crm/doors/${ID}/submissions${query}`),
    } as never),
  ).then(
    (r) => r as Response,
    (e: { status?: number }) => ({ status: e.status }) as Response,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.getDoor.mockResolvedValue({ id: ID, kind: 'form', config: {} });
  mocks.listSubmissions.mockResolvedValue({ rows: [], nextCursor: null });
});

describe('GET /api/crm/doors/[id]/submissions', () => {
  it('needs crm:manage — a crm:view role gets 403 and reads nothing', async () => {
    mocks.requireOrgCapability.mockImplementation(async () => {
      throw error(403, 'crm: manage required');
    });
    expect((await call()).status).toBe(403);
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith({}, 'crm', 'manage');
    expect(mocks.listSubmissions).not.toHaveBeenCalled();
  });

  it('401 without a tenant context', async () => {
    mocks.getCoreCtx.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it('404 for a missing or non-form door', async () => {
    mocks.getDoor.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    mocks.getDoor.mockResolvedValueOnce({ id: ID, kind: 'faq', config: {} });
    expect((await call()).status).toBe(404);
  });

  it('passes cursor, limit and the masking decision through', async () => {
    mocks.shouldMaskSensitive.mockResolvedValue(true);
    const res = await call('?cursor=abc&limit=10');
    expect(res.status).toBe(200);
    expect(mocks.listSubmissions).toHaveBeenCalledWith(
      { tenantId: 'org-1' },
      { id: ID, kind: 'form', config: {} },
      { cursor: 'abc', limit: 10, mask: true },
    );
    expect(mocks.shouldMaskSensitive).toHaveBeenCalledWith({}, 'crm');
  });
});
