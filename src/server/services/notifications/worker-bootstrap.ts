import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import type { OwnedWorkerService } from '$server/worker-lifecycle';
import { createNotificationWorkerLoop } from './scheduler/loop';
import { admitNotificationWorker } from './scheduler/admission';

let owner: OwnedWorkerService | null = null;

/** Explicit adapter-node admission only. Imports on Vercel/prerender start nothing. */
export function bootstrapNotificationWorker(): OwnedWorkerService | null {
  if (building || env.DESKTOP !== '1' || env.NOTIFICATION_WORKER !== '1') return null;
  owner ??= createNotificationWorkerLoop(admitNotificationWorker);
  return owner;
}
