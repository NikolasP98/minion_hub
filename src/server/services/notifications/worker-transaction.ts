import type postgres from 'postgres';
import { getRlsPgClient } from '$server/db/pg-pool';
import { UUID_PATTERN } from '$lib/notifications/fields';
import { notificationWorkerFailure, reportNotificationWorkerFailure } from './worker-failure';

export type NotificationWorkerTx = postgres.TransactionSql;
export type NotificationWorkerScope = Readonly<{ organizationId: string; ownerId: string }>;

/** Dedicated transaction-only pool avoids interleaving RLS setup with ordinary pooled reads. */
export async function withNotificationWorkerTransaction<T>(
  scope: NotificationWorkerScope,
  fn: (tx: NotificationWorkerTx) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(scope.organizationId) || !UUID_PATTERN.test(scope.ownerId))
    throw new Error('Invalid notification worker scope');
  // SET LOCAL state is rolled back by PostgreSQL on every failure and ends at successful commit.
  // No Promise.race releases a pool slot while an underlying statement is still running.
  try {
    return (await getRlsPgClient().begin(async (tx) => {
      await tx`select set_config('role','notification_worker',true),set_config('app.current_org_id',${scope.organizationId},true),set_config('app.current_profile_id','',true),set_config('app.notification_owner',${scope.ownerId},true),set_config('app.notification_scope_mode','',true),set_config('app.notification_event_id','',true),set_config('app.notification_generation','',true),set_config('app.notification_quarantine_reason','',true),set_config('statement_timeout','3s',true),set_config('lock_timeout','250ms',true),set_config('idle_in_transaction_session_timeout','5s',true)`;
      return await fn(tx);
    })) as T;
  } catch (error) {
    const failure = notificationWorkerFailure(error);
    if (!failure) throw error;
    reportNotificationWorkerFailure(failure);
    throw failure;
  }
}
