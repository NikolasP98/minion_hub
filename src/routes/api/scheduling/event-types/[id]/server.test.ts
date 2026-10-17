import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleWriteError } from '$server/services/errors';
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), capability: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => ({ tenantId: 'org' }) }));
vi.mock('$server/auth/scheduling-read', () => ({
  requireSchedulingRead: async () => ({ tenantId: 'org' }),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: mocks.capability }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => true }));
vi.mock('$server/services/scheduling.service', () => ({
  upsertEventType: mocks.upsert,
  getEventType: vi.fn(),
  deleteEventType: vi.fn(),
  parseScheduleRules: () => [],
}));
import { PATCH } from './+server';
const token = '2026-10-16T00:00:00.000Z';
const call = (extra: Record<string, unknown>) =>
  PATCH({
    locals: {},
    params: { id: 'event' },
    request: new Request('http://localhost/api/scheduling/event-types/event', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 's', title: 'Service', length: 30, ...extra }),
    }),
  } as never);
beforeEach(() => vi.clearAllMocks());
describe('event type version admission', () => {
  it('rejects missing and malformed tokens before mutation', async () => {
    await expect(call({})).rejects.toMatchObject({ status: 400 });
    await expect(call({ expectedUpdatedAt: 'bad' })).rejects.toMatchObject({ status: 400 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('returns the actual update token after checking capabilities', async () => {
    mocks.upsert.mockImplementation(async (_ctx, _input, _id, _expected, onUpdated) => {
      onUpdated(new Date('2026-10-16T00:00:00.001Z'));
      return 'event';
    });
    const response = await call({ expectedUpdatedAt: token });
    expect(await response.json()).toEqual({ ok: true, updatedAt: '2026-10-16T00:00:00.001Z' });
    expect(mocks.capability).toHaveBeenCalledWith({}, 'scheduling', 'manage');
    expect(mocks.upsert.mock.calls[0][3]).toEqual(new Date(token));
  });
  it('maps stale409 and missing404 without claiming success', async () => {
    mocks.upsert.mockRejectedValueOnce(new StaleWriteError({ id: 'event' }));
    expect((await call({ expectedUpdatedAt: token })).status).toBe(409);
    mocks.upsert.mockRejectedValueOnce(new Error('event type not found'));
    await expect(call({ expectedUpdatedAt: token })).rejects.toMatchObject({ status: 404 });
  });
});
