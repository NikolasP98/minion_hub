import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleWriteError } from '$server/services/errors';

const state = vi.hoisted(() => ({
  update: vi.fn(
    async (_ctx: unknown, _id: string, _patch: unknown, _expected?: Date) =>
      ({ updatedAt: new Date('2026-06-02T00:00:00Z') }) as { updatedAt: Date },
  ),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/hr.service', () => ({
  HrRuleError: class HrRuleError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  updateEmployee: (ctx: unknown, id: string, patch: unknown, expected?: Date) =>
    state.update(ctx, id, patch, expected),
}));

const { PATCH } = await import('./+server');
const patch = (body: unknown) =>
  PATCH({
    locals: {},
    params: { id: 'emp-1' },
    request: new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/scheduling/hr/employees/[id] — stale-write guard', () => {
  it('threads a fresh expectedUpdatedAt (not as an employee field) and answers the new token', async () => {
    const res = await patch({
      designation: 'Nurse',
      expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'emp-1',
      { designation: 'Nurse' },
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect(await res.json()).toEqual({ ok: true, updatedAt: '2026-06-02T00:00:00.000Z' });
  });

  it('answers 409 { error: stale, current } for a stale token (via hrTry)', async () => {
    const current = { id: 'emp-1', designation: 'Theirs' };
    state.update.mockRejectedValueOnce(new StaleWriteError(current));
    const res = await patch({ designation: 'Mine', expectedUpdatedAt: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale', current });
  });
});
