import type { EventEmitter } from 'node:events';
import { quiesceJobs, drainJobs } from '$server/services/bg-runtime';
import { closePgPools } from '$server/db/pg-pool';
import { closeCache } from '$lib/server/cache';

const requests = new Set<Promise<unknown>>();

/** Socket closure does not settle the corresponding asynchronous route handler. */
// TODO(handoff): A resolved streaming Response can retain body/deferred work beyond
// this promise; qualify stream body lifetime separately before certifying all Node
// routes. Buffered cron JSON and tracked job callbacks are the current boundary.
// See meta proposals/2026-09-12-360-continuation-review-followups.md (SDK/transport).
export function trackWorkerRequest<T>(request: Promise<T>): Promise<T> {
  requests.add(request);
  void request.then(
    () => requests.delete(request),
    () => requests.delete(request),
  );
  return request;
}

async function drainRequests(): Promise<void> {
  while (requests.size) await Promise.allSettled([...requests]);
}

interface WorkerResources {
  quiesce(): void;
  drain(): Promise<void>;
  closeCache(): Promise<void>;
  closePools(): Promise<void>;
  failed(): void;
}

export interface OwnedWorkerService {
  quiesce(): void;
  drain(): Promise<void>;
}

export interface WorkerLifecycle extends OwnedWorkerService {
  add(service: OwnedWorkerService): void;
  dispose(): Promise<void>;
}

const owners = new WeakMap<EventEmitter, WorkerLifecycle>();

/** Adapter-node owns HTTP shutdown. Signals stop job admission immediately;
 * its shutdown event stops socket admission, then actual route promises and
 * background callbacks must settle before resource cleanup.
 * No forced deadline: a stuck callback requires an operator's explicit decision.
 */
export function installWorkerLifecycle(
  events: EventEmitter,
  resources: WorkerResources = {
    quiesce: quiesceJobs,
    drain: drainJobs,
    closeCache,
    closePools: closePgPools,
    failed: () => console.error('[worker] graceful shutdown failed; operator review required'),
  },
): WorkerLifecycle {
  const existing = owners.get(events);
  if (existing) return existing;
  let shutdown: Promise<void> | undefined;
  let serviceDrain: Promise<void> | undefined;
  let stopped = false;
  let disposed = false;
  const services = new Set<OwnedWorkerService>();
  const quiesce = () => {
    if (stopped) return;
    stopped = true;
    resources.quiesce();
    for (const service of services) service.quiesce();
  };
  const drain = () => {
    quiesce();
    serviceDrain ??= (async () => {
      await drainRequests();
      // Wait for every owned promise even if one drain fails. Resource closure
      // must not win a race against another still-running startup or query.
      const results = await Promise.allSettled([
        resources.drain(),
        ...[...services].map((service) => service.drain()),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Worker service drain failed');
      }
    })();
    return serviceDrain;
  };
  const finish = () => {
    shutdown ??= (async () => {
      await drain();
      await resources.closeCache();
      await resources.closePools();
    })();
    void shutdown.catch(resources.failed);
  };
  const lifecycle: WorkerLifecycle = {
    add(service) {
      if (disposed || serviceDrain) throw new Error('Worker lifecycle admission is closed');
      if (services.has(service)) return;
      services.add(service);
      if (stopped) service.quiesce();
    },
    quiesce,
    drain,
    async dispose() {
      await drain();
      if (shutdown) await shutdown;
      if (disposed) return;
      disposed = true;
      events.off('SIGTERM', quiesce);
      events.off('SIGINT', quiesce);
      events.off('sveltekit:shutdown', finish);
      owners.delete(events);
    },
  };
  owners.set(events, lifecycle);
  events.on('SIGTERM', quiesce);
  events.on('SIGINT', quiesce);
  events.once('sveltekit:shutdown', finish);
  return lifecycle;
}
