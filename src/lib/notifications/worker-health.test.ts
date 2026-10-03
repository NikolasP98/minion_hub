import { describe, expect, it } from 'vitest';
import type { NotificationWorkerHealth } from './worker-health';
import { decodeNotificationWorkerHealth } from './worker-health';

function health(): NotificationWorkerHealth {
  return {
    checkedAt: '2026-10-03T12:00:00.000Z',
    state: 'runnable',
    worker: {
      heartbeat: { ageMs: 250, futureTimestamp: false },
      identity: {
        buildSha: 'a'.repeat(40),
        catalogRevision: '2026-10-03.v1',
        catalogSha256: 'b'.repeat(64),
        projectorRevision: 'projection.v1',
        projectorSha256: 'c'.repeat(64),
      },
      admission: null,
    },
    organization: {
      lastCompleted: { ageMs: 500, futureTimestamp: false },
      lastSuccess: { ageMs: 500, futureTimestamp: false },
      failureStreak: 0,
      lastFailureCode: null,
      lastResult: 'completed',
    },
    queue: {
      pending: {
        count: 5000,
        lowerBound: true,
        oldest: { ageMs: 60_000, futureTimestamp: false },
      },
      processing: {
        count: 0,
        lowerBound: false,
        oldest: { ageMs: null, futureTimestamp: false },
      },
      unsupportedCatalogPending: false,
    },
  };
}

describe('notification worker health wire contract', () => {
  it('accepts the bounded queue sentinel and qualified worker identity', () => {
    expect(decodeNotificationWorkerHealth(health())).toEqual(health());
  });

  it.each([
    [
      'unknown property',
      (value: NotificationWorkerHealth) =>
        Object.assign(value as unknown as { ownerId: string }, { ownerId: 'x' }),
    ],
    [
      'unbounded count',
      (value: NotificationWorkerHealth) =>
        ((value.queue.pending as { count: number }).count = 5001),
    ],
    [
      'false lower bound',
      (value: NotificationWorkerHealth) =>
        ((value.queue.pending as { count: number }).count = 4999),
    ],
    [
      'future age presented as elapsed',
      (value: NotificationWorkerHealth) =>
        ((value.worker.heartbeat as { futureTimestamp: boolean }).futureTimestamp = true),
    ],
    [
      'failure code without streak',
      (value: NotificationWorkerHealth) =>
        ((value.organization as { lastFailureCode: string | null }).lastFailureCode =
          'projection_failed'),
    ],
    [
      'unqualified build identity',
      (value: NotificationWorkerHealth) =>
        ((value.worker.identity as { buildSha: string }).buildSha = 'development'),
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = health();
    mutate(value);
    expect(() => decodeNotificationWorkerHealth(value)).toThrow('Invalid notification health');
  });

  it('accepts a finite admission degradation without manufacturing active identity', () => {
    const base = health();
    const value: NotificationWorkerHealth = {
      ...base,
      state: 'projection_unavailable',
      worker: {
        heartbeat: { ageMs: null, futureTimestamp: false },
        identity: null,
        admission: {
          checked: { ageMs: 1000, futureTimestamp: false },
          code: 'projection_unavailable',
          buildSha: null,
          artifactSha256: null,
          catalogRevision: 'catalog.v1',
          catalogSha256: 'd'.repeat(64),
          projectorRevision: null,
          projectorSha256: null,
        },
      },
    };
    expect(decodeNotificationWorkerHealth(value)).toEqual(value);
  });

  it('accepts explicitly unavailable admission revisions without inferring them from hashes', () => {
    const base = health();
    const value: NotificationWorkerHealth = {
      ...base,
      state: 'catalog_invalid',
      worker: {
        heartbeat: { ageMs: null, futureTimestamp: false },
        identity: null,
        admission: {
          checked: { ageMs: 1000, futureTimestamp: false },
          code: 'catalog_invalid',
          buildSha: null,
          artifactSha256: null,
          catalogRevision: null,
          catalogSha256: null,
          projectorRevision: null,
          projectorSha256: null,
        },
      },
    };
    expect(decodeNotificationWorkerHealth(value)).toEqual(value);
  });

  it.each([
    [
      'missing catalog revision',
      (admission: Record<string, unknown>) => delete admission.catalogRevision,
    ],
    [
      'extra admission field',
      (admission: Record<string, unknown>) => (admission.ownerId = 'hidden'),
    ],
    [
      'invalid catalog revision',
      (admission: Record<string, unknown>) => (admission.catalogRevision = 'bad revision'),
    ],
    [
      'overflow projector revision',
      (admission: Record<string, unknown>) => (admission.projectorRevision = `p${'x'.repeat(64)}`),
    ],
  ])('rejects %s in exact admission evidence', (_name, mutate) => {
    const base = health();
    const admission: Record<string, unknown> = {
      checked: { ageMs: 1000, futureTimestamp: false },
      code: 'projection_unavailable',
      buildSha: null,
      artifactSha256: null,
      catalogRevision: 'catalog.v1',
      catalogSha256: 'd'.repeat(64),
      projectorRevision: null,
      projectorSha256: null,
    };
    mutate(admission);
    const raw = {
      ...base,
      state: 'projection_unavailable',
      worker: { heartbeat: { ageMs: null, futureTimestamp: false }, identity: null, admission },
    };
    expect(() => decodeNotificationWorkerHealth(raw)).toThrow('Invalid notification health');
  });
});
