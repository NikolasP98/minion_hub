import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionError } from '$server/services/stock-corrections.logic';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  requireCoreCtx: vi.fn(),
  setLockPolicy: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: mocks.requireCoreCtx }));
vi.mock('$server/services/record-locks.service', () => ({
  setLockPolicy: mocks.setLockPolicy,
  logLockEvent: vi.fn(),
  personActor: (c: { profileId?: string }, name: string | null) => ({
    kind: 'person',
    id: c.profileId ?? null,
    name,
  }),
}));

import { PUT } from './policy/+server';

const ctx = { tenantId: 'org-1', profileId: 'p1' };
const locals = { user: { id: 'u1', displayName: 'Ada', email: 'a@x.test' } };
const put = (body: string) =>
  PUT({
    locals,
    request: new Request('http://hub.test/api/settings/record-locks/policy', {
      method: 'PUT',
      body,
    }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.requireCoreCtx.mockResolvedValue(ctx);
});

describe('PUT /api/settings/record-locks/policy', () => {
  it('an owner saves the rules; the actor is the signed-in person', async () => {
    const policy = { month: true, days: 60, sunat: false, webhook: false };
    mocks.setLockPolicy.mockResolvedValue(policy);
    const res = await put(JSON.stringify({ month: true, days: 60, webhook: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policy });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(locals, 'settings', 'manage');
    expect(mocks.setLockPolicy).toHaveBeenCalledWith(
      ctx,
      { month: true, days: 60, webhook: false },
      { kind: 'person', id: 'p1', name: 'Ada' },
    );
  });

  it('an admin gets 403 owner_required with the code in the body', async () => {
    mocks.setLockPolicy.mockRejectedValue(new CorrectionError('only an owner', 'owner_required'));
    const res = await put(JSON.stringify({ month: true, days: null, webhook: false }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'owner_required' });
  });

  it('bad days and unknown keys are 400 invalid_policy', async () => {
    mocks.setLockPolicy.mockRejectedValue(new CorrectionError('days', 'invalid_policy'));
    const res = await put(JSON.stringify({ month: true, days: 0, webhook: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_policy' });
  });

  it('a body that is not JSON is 400 before the service runs', async () => {
    await expect(put('not json')).rejects.toMatchObject({ status: 400 });
    expect(mocks.setLockPolicy).not.toHaveBeenCalled();
  });

  it('a caller without settings:manage never reaches the service', async () => {
    mocks.requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(put('{}')).rejects.toMatchObject({ status: 403 });
    expect(mocks.setLockPolicy).not.toHaveBeenCalled();
  });
});
