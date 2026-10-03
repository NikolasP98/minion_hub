import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ authority: vi.fn(), health: vi.fn() }));
vi.mock('$server/services/notifications/authority', () => ({
  requireNotificationRuleManager: calls.authority,
}));
vi.mock('$server/services/notifications/worker-health', () => ({
  readNotificationWorkerHealth: calls.health,
}));

import { GET } from './+server';

const orgId = '11111111-1111-4111-8111-111111111111';
const locals = { user: { id: 'actor' } } as never;
const health = {
  checkedAt: '2026-10-03T12:00:00.000Z',
  state: 'projection_unavailable',
  worker: {
    heartbeat: { ageMs: null, futureTimestamp: false },
    identity: null,
    admission: null,
  },
  organization: {
    lastCompleted: { ageMs: null, futureTimestamp: false },
    lastSuccess: { ageMs: null, futureTimestamp: false },
    failureStreak: 0,
    lastFailureCode: null,
    lastResult: null,
  },
  queue: {
    pending: { count: 5000, lowerBound: true, oldest: { ageMs: 10, futureTimestamp: false } },
    processing: { count: 0, lowerBound: false, oldest: { ageMs: null, futureTimestamp: false } },
    unsupportedCatalogPending: false,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  calls.authority.mockResolvedValue({ tenantId: orgId, profileId: 'actor' });
  calls.health.mockResolvedValue(health);
});

describe('GET /api/notifications/health', () => {
  it('reads only the freshly authorized canonical organization and disables caching', async () => {
    const response = await GET({
      locals,
      url: new URL('http://localhost/api/notifications/health'),
    } as never);
    expect(calls.authority).toHaveBeenCalledExactlyOnceWith(locals);
    expect(calls.health).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(health);
  });

  it('returns fixed unavailable data rather than false zero health or provider detail', async () => {
    calls.health.mockRejectedValue(new Error('postgres password and private query'));
    const response = await GET({
      locals,
      url: new URL('http://localhost/api/notifications/health'),
    } as never);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ code: 'notification_health_unavailable' });
    expect(body).not.toContain('postgres password');
  });

  it('rejects arbitrary selectors before authority or storage', async () => {
    await expect(
      GET({
        locals,
        url: new URL(`http://localhost/api/notifications/health?orgId=${orgId}`),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls.authority).not.toHaveBeenCalled();
    expect(calls.health).not.toHaveBeenCalled();
  });

  it('does not read health when fresh comms manage authority rejects', async () => {
    calls.authority.mockRejectedValue({ status: 403 });
    await expect(
      GET({ locals, url: new URL('http://localhost/api/notifications/health') } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.health).not.toHaveBeenCalled();
  });
});
