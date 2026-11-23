import { describe, it, expect, vi, beforeEach } from 'vitest';

const svc = vi.hoisted(() => ({ createClosures: vi.fn(), reopenClosure: vi.fn() }));
vi.mock('$server/services/scheduling-closures.service', async () => {
  class ClosureError extends Error {
    constructor(
      message: string,
      readonly code: 'invalid' | 'not_found',
    ) {
      super(message);
    }
  }
  return { ...svc, ClosureError };
});

import { createClosuresResponse, reopenClosureResponse } from './_handlers';
import { ClosureError } from '$server/services/scheduling-closures.service';
import type { CoreCtx } from '$server/auth/core-ctx';

const ctx = { tenantId: 'org-a', profileId: 'p1' } as unknown as CoreCtx;
const locals = { user: { displayName: 'Ana' } } as unknown as App.Locals;
const req = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

beforeEach(() => vi.clearAllMocks());

describe('closure handlers (spec 147)', () => {
  it('creates and answers 201 with the actor passed through', async () => {
    svc.createClosures.mockResolvedValue({ groupId: 'g', count: 3 });
    const res = await createClosuresResponse(
      ctx,
      locals,
      req({ fromDate: '2026-11-24', toDate: '2026-11-26', reason: 'Viaje' }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ groupId: 'g', count: 3 });
    expect(svc.createClosures.mock.calls[0][2]).toEqual({ id: 'p1', name: 'Ana' });
  });

  it('maps a rule refusal to 400', async () => {
    svc.createClosures.mockRejectedValue(new ClosureError('reason is required', 'invalid'));
    await expect(
      createClosuresResponse(ctx, locals, req({ fromDate: '2026-11-24', reason: '' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('reopen: a non-uuid id is a 404 without touching the service; group is forwarded', async () => {
    await expect(reopenClosureResponse(ctx, locals, 'nope', req({}))).rejects.toMatchObject({
      status: 404,
    });
    expect(svc.reopenClosure).not.toHaveBeenCalled();
    svc.reopenClosure.mockResolvedValue(5);
    const res = await reopenClosureResponse(ctx, locals, ID, req({ group: true }));
    expect(await res.json()).toEqual({ removed: 5 });
    expect(svc.reopenClosure.mock.calls[0][2]).toEqual({ group: true });
  });
});
