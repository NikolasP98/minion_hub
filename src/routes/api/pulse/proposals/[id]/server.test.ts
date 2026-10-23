import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { error } from '@sveltejs/kit';

const boundary = vi.hoisted(() => ({
  ctx: { db: {}, tenantId: 'org-1', profileId: 'user-1' },
  requireCapability: vi.fn(),
  requireCoreCtx: vi.fn(),
  decide: vi.fn(),
  edit: vi.fn(),
  gateway: vi.fn(),
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallAsUser: boundary.gateway }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: boundary.requireCapability,
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: boundary.requireCoreCtx }));
vi.mock('$server/services/pulse.service', () => ({
  decidePulseProposal: boundary.decide,
  editPulseProposal: boundary.edit,
}));

import { POST } from './+server';

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' } } as App.Locals;
}
function call(id: string, body: unknown, locals = makeLocals()) {
  return POST({
    locals,
    params: { id },
    request: new Request(`http://x/api/pulse/proposals/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  } as Parameters<typeof POST>[0]);
}
const receipt = {
  proposalId: 'p1',
  revision: 2,
  decision: 'approved',
  decidedAt: '2026-10-23T00:00:00.000Z',
  receiptId: 'dispatch-1',
  dispatch: { state: 'queued', reason: null, remoteJobId: null },
};

beforeEach(() => {
  vi.resetAllMocks();
  boundary.requireCapability.mockResolvedValue(undefined);
  boundary.requireCoreCtx.mockResolvedValue(boundary.ctx);
  boundary.decide.mockResolvedValue(receipt);
});
afterEach(() => {
  // Scheduling belongs to the durable worker, including duplicate and failed decisions.
  expect(boundary.gateway).not.toHaveBeenCalled();
});

describe('POST /api/pulse/proposals/[id] versioned decision boundary', () => {
  it('returns the durable decision receipt for the exact rendered revision without a route RPC', async () => {
    const locals = makeLocals();
    const response = await call('p1', { action: 'approve', expectedRevision: 2 }, locals);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    expect(boundary.requireCapability).toHaveBeenCalledWith(locals, 'pulse', 'edit');
    expect(boundary.requireCoreCtx).toHaveBeenCalledWith(locals);
    expect(boundary.decide).toHaveBeenCalledExactlyOnceWith(boundary.ctx, 'p1', 'approve', 2);
  });

  it('preserves the legacy informational decision without inventing a dispatch receipt', async () => {
    const decision = {
      proposalId: 'digest-1',
      revision: 1,
      decision: 'approved',
      decidedAt: receipt.decidedAt,
    };
    boundary.decide.mockResolvedValue(decision);

    const response = await call('digest-1', { action: 'approve' });

    expect(await response.json()).toEqual(decision);
    expect(boundary.decide).toHaveBeenCalledExactlyOnceWith(
      boundary.ctx,
      'digest-1',
      'approve',
      undefined,
    );
  });

  it('passes dismissal and the rendered revision to the same atomic decision service', async () => {
    const dismissed = { proposalId: 'p3', revision: 3, decision: 'dismissed', decidedAt: null };
    boundary.decide.mockResolvedValue(dismissed);

    const response = await call('p3', { action: 'dismiss', expectedRevision: 3 });

    expect(await response.json()).toEqual(dismissed);
    expect(boundary.decide).toHaveBeenCalledExactlyOnceWith(boundary.ctx, 'p3', 'dismiss', 3);
  });

  it('preserves the same 404 for absent and inaccessible owner-bound proposals', async () => {
    boundary.decide.mockImplementation(async () => error(404, 'proposal not found'));

    for (const id of ['missing', 'other-owner']) {
      await expect(call(id, { action: 'approve', expectedRevision: 1 })).rejects.toMatchObject({
        status: 404,
        body: { message: 'proposal not found' },
      });
    }
    expect(boundary.decide).toHaveBeenCalledTimes(2);
  });

  it('returns the original receipt for duplicate identical approval without scheduling in the route', async () => {
    const first = await call('p1', { action: 'approve', expectedRevision: 2 });
    const second = await call('p1', { action: 'approve', expectedRevision: 2 });

    expect(await first.json()).toEqual(receipt);
    expect(await second.json()).toEqual(receipt);
    expect(boundary.decide).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 1])(
    'propagates refresh-required conflict for executable revision %s',
    async (expectedRevision) => {
      boundary.decide.mockImplementation(async () => error(409, 'refresh_required'));

      await expect(call('p1', { action: 'approve', expectedRevision })).rejects.toMatchObject({
        status: 409,
        body: { message: 'refresh_required' },
      });
      expect(boundary.decide).toHaveBeenCalledExactlyOnceWith(
        boundary.ctx,
        'p1',
        'approve',
        expectedRevision,
      );
    },
  );

  it.each([null, '2', 0, 1.5])(
    'rejects malformed revision %s before calling the decision service',
    async (expectedRevision) => {
      await expect(call('p1', { action: 'approve', expectedRevision })).rejects.toMatchObject({
        status: 400,
      });
      expect(boundary.decide).not.toHaveBeenCalled();
    },
  );

  it('rejects unauthenticated callers before capability or decision access', async () => {
    await expect(
      call('p1', { action: 'approve', expectedRevision: 2 }, {} as App.Locals),
    ).rejects.toMatchObject({ status: 401 });
    expect(boundary.requireCapability).not.toHaveBeenCalled();
    expect(boundary.requireCoreCtx).not.toHaveBeenCalled();
    expect(boundary.decide).not.toHaveBeenCalled();
  });

  it('preserves capability denial before acquiring decision context', async () => {
    boundary.requireCapability.mockImplementation(async () =>
      error(403, 'Pulse decision not permitted'),
    );

    await expect(call('p1', { action: 'approve', expectedRevision: 2 })).rejects.toMatchObject({
      status: 403,
    });
    expect(boundary.requireCoreCtx).not.toHaveBeenCalled();
    expect(boundary.decide).not.toHaveBeenCalled();
  });
});
