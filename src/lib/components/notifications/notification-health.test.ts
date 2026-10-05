import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NotificationHealthSeed,
  NotificationWorkerHealth,
} from '$lib/notifications/worker-health';
import { createNotificationHealthController } from './notification-health.svelte';

function health(checkedAt: string, state: NotificationWorkerHealth['state'] = 'runnable') {
  return {
    checkedAt,
    state,
    worker: {
      heartbeat: { ageMs: 10, futureTimestamp: false },
      identity: {
        buildSha: 'a'.repeat(40),
        catalogRevision: 'catalog.v1',
        catalogSha256: 'b'.repeat(64),
        projectorRevision: 'projector.v1',
        projectorSha256: 'c'.repeat(64),
      },
      admission: null,
    },
    organization: {
      lastCompleted: { ageMs: 20, futureTimestamp: false },
      lastSuccess: { ageMs: 20, futureTimestamp: false },
      failureStreak: 0,
      lastFailureCode: null,
      lastResult: 'completed',
    },
    queue: {
      pending: {
        count: 0,
        lowerBound: false,
        oldest: { ageMs: null, futureTimestamp: false },
      },
      processing: {
        count: 0,
        lowerBound: false,
        oldest: { ageMs: null, futureTimestamp: false },
      },
      unsupportedCatalogPending: false,
    },
  } satisfies NotificationWorkerHealth;
}

function seed(
  actorId: string,
  orgId: string,
  value: NotificationWorkerHealth,
): NotificationHealthSeed {
  return { actorId, orgId, status: 'ready', value };
}

function response(value: NotificationWorkerHealth): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('notification health controller', () => {
  it('retains a same-owner snapshot as stale after failure and repairs it without reload', async () => {
    const initial = health('2026-10-03T12:00:00.000Z');
    const repaired = health('2026-10-03T12:01:00.000Z');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(response(repaired)),
    );
    const state = createNotificationHealthController(
      { actorId: 'actor', orgId: 'org' },
      seed('actor', 'org', initial),
    );
    await state.refresh();
    expect(state.value).toEqual(initial);
    expect(state.status).toBe('failed');
    expect(state.stale).toBe(true);
    await state.refresh();
    expect(state.value).toEqual(repaired);
    expect(state.status).toBe('ready');
    expect(state.stale).toBe(false);
  });

  it('clears on actor or organization replacement and suppresses A to B to A late responses', async () => {
    const oldA = deferred<Response>();
    const currentA = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(oldA.promise).mockReturnValueOnce(currentA.promise),
    );
    let actorId = 'actor-a';
    let orgId = 'org-a';
    const state = createNotificationHealthController(
      { actorId, orgId },
      seed(actorId, orgId, health('2026-10-03T12:00:00.000Z')),
    );
    const first = state.refresh();
    actorId = 'actor-b';
    orgId = 'org-b';
    state.reconcile({ actorId, orgId }, { actorId, orgId, status: 'unavailable' });
    expect(state.value).toBeNull();
    expect(state.status).toBe('unavailable');
    actorId = 'actor-a';
    orgId = 'org-a';
    state.reconcile({ actorId, orgId }, { actorId, orgId, status: 'unavailable' });
    const second = state.refresh();
    oldA.resolve(response(health('2026-10-03T12:05:00.000Z')));
    await first;
    expect(state.value).toBeNull();
    currentA.resolve(response(health('2026-10-03T12:06:00.000Z')));
    await second;
    expect(state.value?.checkedAt).toBe('2026-10-03T12:06:00.000Z');
  });

  it('makes a disposed late response inert', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    );
    const state = createNotificationHealthController(
      { actorId: 'actor', orgId: 'org' },
      seed('actor', 'org', health('2026-10-03T12:00:00.000Z')),
    );
    const request = state.refresh();
    state.dispose();
    pending.resolve(response(health('2026-10-03T12:10:00.000Z')));
    await request;
    expect(state.value).toBeNull();
    expect(state.status).toBe('unavailable');
  });
});
