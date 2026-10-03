import { getRlsPgClient } from '$server/db/pg-pool';
import { UUID_PATTERN } from '$lib/notifications/fields';
import type { NotificationWorkerTx } from '../worker-transaction';
import { notificationWorkerFailure, reportNotificationWorkerFailure } from '../worker-failure';
import { assertGeneration, NotificationSchedulerUnavailable } from './contracts';

/** Operational authority never crosses into event projection or an HTTP health read. */
export async function withCoordinator<T>(
  ownerId: string,
  generation: string | null,
  operation: (tx: NotificationWorkerTx) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(ownerId)) throw new Error('Invalid notification runtime owner');
  if (generation !== null) assertGeneration(generation);
  try {
    return (await getRlsPgClient().begin(async (tx) => {
      await tx`select set_config('role','notification_coordinator',true),
        set_config('app.current_org_id','',true),set_config('app.current_profile_id','',true),
        set_config('app.notification_owner','',true),set_config('app.notification_generation','',true),
        set_config('app.notification_runtime_owner',${ownerId},true),
        set_config('app.notification_runtime_generation',${generation ?? ''},true),
        set_config('app.notification_org_generation','',true),set_config('app.notification_abandon_unstarted','',true),
        set_config('statement_timeout','3s',true),set_config('lock_timeout','250ms',true),
        set_config('idle_in_transaction_session_timeout','5s',true)`;
      return await operation(tx);
    })) as T;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      Object.getOwnPropertyDescriptor(error, 'code')?.value === '22003'
    )
      throw new NotificationSchedulerUnavailable('generation_exhausted');
    const failure = notificationWorkerFailure(error);
    if (!failure) throw error;
    reportNotificationWorkerFailure(failure);
    throw failure;
  }
}
