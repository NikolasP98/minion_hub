import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionError } from '$server/services/stock-corrections.logic';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  requireCoreCtx: vi.fn(),
  setLockPolicy: vi.fn(),
  grantUnlock: vi.fn(),
  liftLock: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: mocks.requireCoreCtx }));
vi.mock('$server/services/record-locks.service', () => ({
  setLockPolicy: mocks.setLockPolicy,
  grantUnlock: mocks.grantUnlock,
  liftLock: mocks.liftLock,
  logLockEvent: vi.fn(),
  personActor: (c: { profileId?: string }, name: string | null) => ({
    kind: 'person',
    id: c.profileId ?? null,
    name,
  }),
}));

import { PUT } from './policy/+server';
import { POST as UNLOCK } from './unlocks/+server';
import { POST as LIFT } from './locks/[id]/lift/+server';

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

describe('POST /api/settings/record-locks/unlocks', () => {
  const body = { recordType: 'stock_receipt', recordId: 'r1', reason: 'typo' };
  const post = (raw: string) =>
    UNLOCK({
      locals,
      request: new Request('http://hub.test/api/settings/record-locks/unlocks', {
        method: 'POST',
        body: raw,
      }),
    } as never) as Promise<Response>;

  it('an owner gets 201 with the new unlock; the actor is the signed-in person', async () => {
    mocks.grantUnlock.mockResolvedValue({
      eventId: 'e1',
      expiresAt: '2026-11-25T10:00:00.000Z',
      created: true,
    });
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ eventId: 'e1', expiresAt: '2026-11-25T10:00:00.000Z' });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(locals, 'settings', 'manage');
    expect(mocks.grantUnlock).toHaveBeenCalledWith(ctx, body, {
      kind: 'person',
      id: 'p1',
      name: 'Ada',
    });
  });

  it('an active unlock answers 200 with the same shape', async () => {
    mocks.grantUnlock.mockResolvedValue({ eventId: 'e0', expiresAt: 'x', created: false });
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ eventId: 'e0', expiresAt: 'x' });
  });

  it.each([
    ['owner_required', 403],
    ['not_found', 404],
    ['not_locked', 409],
    ['not_unlockable', 409],
    ['invalid_request', 400],
  ] as const)('maps %s to %i with the code in the body', async (code, status) => {
    mocks.grantUnlock.mockRejectedValue(new CorrectionError('nope', code));
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, outcome: 'not_applied' });
  });

  it('a body that is not JSON is 400 and a caller without settings:manage never reaches the service', async () => {
    await expect(post('nope')).rejects.toMatchObject({ status: 400 });
    mocks.requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(post(JSON.stringify(body))).rejects.toMatchObject({ status: 403 });
    expect(mocks.grantUnlock).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings/record-locks/locks/[id]/lift', () => {
  const LOCK = '11111111-1111-4111-8111-111111111111';
  const post = (raw: string) =>
    LIFT({
      locals,
      params: { id: LOCK },
      request: new Request('http://hub.test/x', { method: 'POST', body: raw }),
    } as never) as Promise<Response>;

  it('an owner lifts with a reason; the actor is the signed-in person', async () => {
    mocks.liftLock.mockResolvedValue({ lifted: true });
    const res = await post(JSON.stringify({ reason: 'ya corregido' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lifted: true });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(locals, 'settings', 'manage');
    expect(mocks.liftLock).toHaveBeenCalledWith(ctx, LOCK, 'ya corregido', {
      kind: 'person',
      id: 'p1',
      name: 'Ada',
    });
  });

  it('an already lifted lock answers 200 lifted:false', async () => {
    mocks.liftLock.mockResolvedValue({ lifted: false });
    expect(await (await post(JSON.stringify({ reason: 'x' }))).json()).toEqual({ lifted: false });
  });

  it.each([
    ['owner_required', 403],
    ['not_found', 404],
    ['invalid_request', 400],
  ] as const)('maps %s to %i', async (code, status) => {
    mocks.liftLock.mockRejectedValue(new CorrectionError('nope', code));
    const res = await post(JSON.stringify({ reason: 'x' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it('a body that is not an object is 400, and settings:manage is required first', async () => {
    await expect(post('[]')).rejects.toMatchObject({ status: 400 });
    mocks.requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(post('{}')).rejects.toMatchObject({ status: 403 });
    expect(mocks.liftLock).not.toHaveBeenCalled();
  });
});
