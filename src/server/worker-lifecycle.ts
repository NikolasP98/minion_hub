import type { EventEmitter } from 'node:events';
import { quiesceJobs, drainJobs } from '$server/services/bg-runtime';
import { closePgPools } from '$server/db/pg-pool';
import { closeCache } from '$lib/server/cache';

interface WorkerResources {
  quiesce(): void;
  drain(): Promise<void>;
  closeCache(): Promise<void>;
  closePools(): Promise<void>;
  failed(): void;
}

/** Adapter-node owns HTTP shutdown. Signals stop job admission immediately;
 * its shutdown event confirms HTTP draining before background/resource cleanup.
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
