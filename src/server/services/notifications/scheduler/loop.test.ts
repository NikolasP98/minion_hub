import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotificationAdmission, NotificationProjector } from './projector-contract';
import type { OrganizationLease, RuntimeLease } from './contracts';

const persistence = vi.hoisted(() => ({
  acquire: vi.fn(),
  heartbeat: vi.fn(),
  release: vi.fn(),
  publish: vi.fn(),
  discover: vi.fn(),
  renew: vi.fn(),
  complete: vi.fn(),
  abandon: vi.fn(),
  isLive: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./runtime-lease', () => ({
  acquireRuntimeLease: persistence.acquire,
  heartbeatRuntimeLease: persistence.heartbeat,
  releaseRuntimeLease: persistence.release,
  publishAdmissionObservation: persistence.publish,
}));
vi.mock('./discovery', () => ({ discoverNotificationOrganizations: persistence.discover }));
vi.mock('./organization-lease', () => ({
  renewOrganizationLease: persistence.renew,
  completeOrganizationLease: persistence.complete,
  abandonUnstartedOrganizationLease: persistence.abandon,
  isOrganizationLeaseLive: persistence.isLive,
}));
vi.mock('./telemetry', () => ({
  reportNotificationLoopFailure: persistence.report,
  recordNotificationMetric: vi.fn(),
}));
vi.mock('../worker-failure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worker-failure')>()),
  reportNotificationWorkerFailure: vi.fn(),
}));
import { createNotificationWorkerLoop } from './loop';
import { NotificationCoordinatorBusy } from './contention';

const runtime: RuntimeLease = {
  ownerId: '20000000-0000-4000-8000-0000000000a1',
  buildSha: 'a'.repeat(40),
  catalogRevision: '2026-10-03.1',
  catalogSha256: 'b'.repeat(64),
  projectorRevision: 'fixture.1',
  projectorSha256: 'c'.repeat(64),
  generation: '1',
  expiresAt: '2026-10-03T12:00:30.000Z',
};
function lease(index = 1): OrganizationLease {
  return {
    organizationId: `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    ownerId: runtime.ownerId,
    generation: '1',
    expiresAt: runtime.expiresAt,
    hardDeadline: '2026-10-03T12:01:00.000Z',
    hardDeadlineMonotonic: performance.now() + 60000,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function ready(
  project: NotificationProjector['projectPage'] = async () => ({ result: 'empty' }),
): NotificationAdmission {
  return {
    state: 'ready',
    identity: runtime,
    projector: {
      revision: 'fixture.1',
      sha256: 'c'.repeat(64),
      supportedCatalogRevisions: ['2026-10-03.1'],
      projectPage: project,
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  for (const mock of Object.values(persistence)) mock.mockReset();
  persistence.acquire.mockResolvedValue({ state: 'acquired', lease: runtime });
  persistence.heartbeat.mockResolvedValue(runtime);
  persistence.release.mockResolvedValue(true);
  persistence.publish.mockResolvedValue(true);
  persistence.discover.mockResolvedValue({ state: 'idle', leases: [], candidates: 0 });
  persistence.renew.mockImplementation(async (_runtime, receipt: OrganizationLease) => receipt);
  persistence.complete.mockResolvedValue(true);
  persistence.abandon.mockResolvedValue(true);
  persistence.isLive.mockResolvedValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('quiesces a pending admission and awaits its real continuation without acquiring a late lease', async () => {
  const admission = deferred<NotificationAdmission>();
  const admit = vi.fn(() => admission.promise);
  const worker = createNotificationWorkerLoop(admit);
  await vi.advanceTimersByTimeAsync(0);
  expect(admit).toHaveBeenCalledOnce();
  worker.quiesce();
  let drained = false;
  const drain = worker.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  admission.resolve(ready());
  await drain;
  expect(persistence.acquire).not.toHaveBeenCalled();
  expect(persistence.publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('uses one cancellable standby timer and makes no heartbeat before acquiring leadership', async () => {
  persistence.acquire.mockResolvedValue({ state: 'standby', retryAfterMs: 5000 });
  const worker = createNotificationWorkerLoop(async () => ready());
  await vi.advanceTimersByTimeAsync(0);
  expect(persistence.acquire).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(persistence.acquire).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(persistence.acquire).toHaveBeenCalledTimes(2);
  expect(persistence.heartbeat).not.toHaveBeenCalled();
  await worker.drain();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps four noncooperative projections owned after hard deadline and signal until actual settlement', async () => {
  const pending = deferred<{ result: 'completed' }>();
  const signals: AbortSignal[] = [];
  const project = vi.fn(async (_lease: OrganizationLease, signal: AbortSignal) => {
    signals.push(signal);
    return pending.promise;
  });
  persistence.discover.mockResolvedValueOnce({
    state: 'claimed',
    leases: [lease(1), lease(2), lease(3), lease(4)],
    candidates: 4,
  });
  const worker = createNotificationWorkerLoop(async () => ready(project));
  await vi.advanceTimersByTimeAsync(0);
  expect(project).toHaveBeenCalledTimes(4);
  expect(persistence.discover).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60001);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(persistence.discover).toHaveBeenCalledOnce();
  expect(persistence.complete).not.toHaveBeenCalled();
  let drained = false;
  const drain = worker.drain().then(() => {
    drained = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(drained).toBe(false);
  expect(persistence.release).not.toHaveBeenCalled();
  pending.resolve({ result: 'completed' });
  await drain;
  expect(persistence.complete).not.toHaveBeenCalled();
  expect(persistence.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('retains and awaits an admission-observation query that began before shutdown', async () => {
  const pending = deferred<boolean>();
  persistence.publish.mockReturnValue(pending.promise);
  const worker = createNotificationWorkerLoop(async () => ({
    state: 'failed',
    observation: {
      ownerId: runtime.ownerId,
      code: 'projection_unavailable',
      buildSha: runtime.buildSha,
      artifactSha256: null,
      catalogRevision: runtime.catalogRevision,
      catalogSha256: runtime.catalogSha256,
      projectorRevision: null,
      projectorSha256: null,
    },
  }));
  await vi.advanceTimersByTimeAsync(0);
  expect(persistence.publish).toHaveBeenCalledOnce();
  let drained = false;
  const drain = worker.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  pending.resolve(true);
  await drain;
  expect(persistence.acquire).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('backs off discovery outages and returns to normal cadence only after a successful query', async () => {
  persistence.discover
    .mockRejectedValueOnce(new Error('synthetic outage'))
    .mockRejectedValueOnce(new Error('synthetic outage'));
  const worker = createNotificationWorkerLoop(async () => ready());
  await vi.advanceTimersByTimeAsync(0);
  expect(persistence.discover).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(4999);
  expect(persistence.discover).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(persistence.discover).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(29999);
  expect(persistence.discover).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(persistence.discover).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(persistence.discover).toHaveBeenCalledTimes(4);
  await worker.drain();
  expect(vi.getTimerCount()).toBe(0);
});

it('passes shutdown into discovery and awaits abandoning every committed unstarted claim before releasing leadership', async () => {
  const found = deferred<{ state: 'claimed'; leases: OrganizationLease[]; candidates: number }>();
  const abandoned = deferred<boolean>();
  const project = vi.fn(async () => ({ result: 'empty' as const }));
  persistence.discover.mockReturnValueOnce(found.promise);
  persistence.abandon.mockReturnValueOnce(abandoned.promise);
  const worker = createNotificationWorkerLoop(async () => ready(project));
  await vi.advanceTimersByTimeAsync(0);
  const discoverySignal = persistence.discover.mock.calls[0][3] as AbortSignal;
  expect(discoverySignal.aborted).toBe(false);
  const drain = worker.drain();
  expect(discoverySignal.aborted).toBe(true);
  // The transaction committed immediately before cancellation reached its caller.
  found.resolve({ state: 'claimed', leases: [lease(1), lease(2)], candidates: 2 });
  await vi.advanceTimersByTimeAsync(0);
  expect(project).not.toHaveBeenCalled();
  expect(persistence.abandon).toHaveBeenCalledTimes(1);
  expect(persistence.release).not.toHaveBeenCalled();
  abandoned.resolve(true);
  await drain;
  expect(persistence.abandon).toHaveBeenCalledTimes(2);
  expect(persistence.abandon.mock.invocationCallOrder[1]).toBeLessThan(
    persistence.release.mock.invocationCallOrder[0],
  );
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['empty', 'completed'] as const)(
  'does not record %s returned after the hard deadline as a clean result',
  async (result) => {
    const receipt = { ...lease(), hardDeadlineMonotonic: performance.now() + 100 };
    persistence.discover.mockResolvedValueOnce({
      state: 'claimed',
      leases: [receipt],
      candidates: 1,
    });
    const project = vi.fn(async (_lease: OrganizationLease, signal: AbortSignal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { result };
    });
    const worker = createNotificationWorkerLoop(async () => ready(project));
    await vi.advanceTimersByTimeAsync(101);
    expect(project).toHaveBeenCalledOnce();
    expect(persistence.complete).toHaveBeenCalledWith(runtime, receipt, {
      result: 'failed',
      reason: 'deadline',
    });
    await worker.drain();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('does not treat bounded coordinator contention as lost leadership', async () => {
  const projected = deferred<{ result: 'empty' }>();
  const signals: AbortSignal[] = [];
  const project = vi.fn(async (_lease: OrganizationLease, signal: AbortSignal) => {
    signals.push(signal);
    return projected.promise;
  });
  persistence.discover.mockResolvedValueOnce({
    state: 'claimed',
    leases: [lease()],
    candidates: 1,
  });
  persistence.heartbeat.mockRejectedValueOnce(new NotificationCoordinatorBusy());
  const worker = createNotificationWorkerLoop(async () => ready(project));
  await vi.advanceTimersByTimeAsync(10000);
  expect(persistence.heartbeat).toHaveBeenCalledTimes(2);
  expect(signals[0].aborted).toBe(false);
  expect(persistence.release).not.toHaveBeenCalled();
  projected.resolve({ result: 'empty' });
  await vi.advanceTimersByTimeAsync(0);
  expect(persistence.complete).toHaveBeenCalledOnce();
  await worker.drain();
  expect(vi.getTimerCount()).toBe(0);
});

it('retains shutdown ownership after an ambiguous abandon until SQL proves the receipt is no longer live', async () => {
  const found = deferred<{ state: 'claimed'; leases: OrganizationLease[]; candidates: number }>();
  const reconciliation = deferred<boolean>();
  const error = new Error('synthetic ambiguous COMMIT');
  persistence.discover.mockReturnValueOnce(found.promise);
  persistence.abandon.mockRejectedValue(error);
  persistence.isLive.mockResolvedValueOnce(true).mockReturnValueOnce(reconciliation.promise);
  const worker = createNotificationWorkerLoop(async () => ready());
  await vi.advanceTimersByTimeAsync(0);
  let drained = false;
  const drain = worker.drain().then(() => {
    drained = true;
  });
  found.resolve({ state: 'claimed', leases: [lease()], candidates: 1 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(persistence.abandon).toHaveBeenCalledTimes(2);
  expect(persistence.isLive).toHaveBeenCalledTimes(2);
  expect(persistence.release).not.toHaveBeenCalled();
  expect(drained).toBe(false);
  reconciliation.resolve(false);
  await drain;
  expect(persistence.release).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('reports an unknown projector rejection through the bounded sanitizer while persisting a finite failure', async () => {
  const error = new Error('sensitive raw provider response');
  const receipt = lease();
  persistence.discover.mockResolvedValueOnce({
    state: 'claimed',
    leases: [receipt],
    candidates: 1,
  });
  const worker = createNotificationWorkerLoop(async () =>
    ready(async () => {
      throw error;
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(persistence.report).toHaveBeenCalledWith(error);
  expect(persistence.complete).toHaveBeenCalledWith(runtime, receipt, {
    result: 'failed',
    reason: 'projection_failed',
  });
  await worker.drain();
});
