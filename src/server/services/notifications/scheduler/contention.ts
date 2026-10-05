import { NotificationWorkerUnavailable, notificationWorkerFailure } from '../worker-failure';

/** A busy coordinator is not evidence that its lease was lost. */
export class NotificationCoordinatorBusy extends NotificationWorkerUnavailable {
  constructor() {
    super('lock_timeout');
    this.name = 'NotificationCoordinatorBusy';
  }
}

/** Retry only a lock-timeout transaction whose actual rollback has settled.
 * The four-second budget bounds retry admission. An admitted database transaction
 * still owns its real settlement; no pending query or rollback is detached.
 * Domain/provider failures, ambiguous COMMIT errors and stale receipts never retry.
 */
export async function retryCoordinatorContention<T>(operation: () => Promise<T>): Promise<T> {
  const end = performance.now() + 4000;
  for (let attempt = 0; attempt < 16; attempt++) {
    if (attempt > 0 && performance.now() >= end) throw new NotificationCoordinatorBusy();
    try {
      return await operation();
    } catch (error) {
      if (notificationWorkerFailure(error)?.reason !== 'lock_timeout') throw error;
      if (attempt === 15 || performance.now() + 25 >= end) throw new NotificationCoordinatorBusy();
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new NotificationCoordinatorBusy();
}
