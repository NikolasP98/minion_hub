import type { EventEmitter } from 'node:events';
import { quiesceJobs, drainJobs } from '$server/services/bg-runtime';
import { closePgPools } from '$server/db/pg-pool';
import { closeCache } from '$lib/server/cache';

const requests = new Set<Promise<unknown>>();

/** Socket closure does not settle the corresponding asynchronous route handler. */
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
): void {
  let shutdown: Promise<void> | undefined;
  const quiesce = () => resources.quiesce();
  const finish = () => {
    quiesce();
    shutdown ??= (async () => {
      await drainRequests();
      await resources.drain();
      await resources.closeCache();
      await resources.closePools();
    })();
    void shutdown.catch(resources.failed);
  };
  events.on('SIGTERM', quiesce);
  events.on('SIGINT', quiesce);
  events.once('sveltekit:shutdown', finish);
}
