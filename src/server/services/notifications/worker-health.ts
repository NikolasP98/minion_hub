import { createHash } from 'node:crypto';
import { getRlsPgClient } from '$server/db/pg-pool';
import { UUID_PATTERN } from '$lib/notifications/fields';
import { NotificationSchedulerUnavailable } from './scheduler/contracts';
import { recordNotificationMetric, reportNotificationLoopFailure } from './scheduler/telemetry';
import { NOTIFICATION_CATALOG_REVISION } from '$lib/notifications/catalog';
import { notificationCatalogManifest } from '$lib/notifications/catalog-manifest';
import type { NotificationWorkerHealth } from '$lib/notifications/worker-health';
import {
  NotificationWorkerUnavailable,
  notificationWorkerFailure,
  reportNotificationWorkerFailure,
} from './worker-failure';

type Age = NotificationWorkerHealth['worker']['heartbeat'];
type Queue = NotificationWorkerHealth['queue']['pending'];
type RuntimeRow = {
  generation: string;
  owner_id: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  started_at: string | null;
  stopped_at: string | null;
  build_sha: string | null;
  catalog_revision: string | null;
  catalog_sha256: string | null;
  projector_revision: string | null;
  projector_sha256: string | null;
  admission_generation: string;
  admission_checked_at: string | null;
  admission_code: NonNullable<NotificationWorkerHealth['worker']['admission']>['code'] | null;
  admission_build_sha: string | null;
  admission_artifact_sha256: string | null;
  admission_catalog_revision: string | null;
  admission_catalog_sha256: string | null;
  admission_projector_revision: string | null;
  admission_projector_sha256: string | null;
};

function age(now: number, timestamp: string | null): Age {
  if (timestamp === null) return { ageMs: null, futureTimestamp: false };
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error('Notification health timestamp is invalid');
  const delta = now - parsed;
  if (delta < 0) return { ageMs: null, futureTimestamp: true };
  if (!Number.isSafeInteger(delta)) throw new Error('Notification health age is invalid');
  return { ageMs: delta, futureTimestamp: false };
}

/** Caller must first obtain fresh comms:manage authority for this canonical organization. */
export async function readNotificationWorkerHealth(
  organizationId: string,
): Promise<NotificationWorkerHealth> {
  if (!UUID_PATTERN.test(organizationId))
    throw new Error('Invalid notification health organization');
  const started = performance.now();
  try {
    const health = (await getRlsPgClient().begin(
      'isolation level repeatable read read only',
      async (tx) => {
        await tx`select set_config('role','notification_health_reader',true),set_config('app.current_org_id',${organizationId},true),
        set_config('app.current_profile_id','',true),set_config('app.notification_owner','',true),
        set_config('app.notification_generation','',true),set_config('app.notification_runtime_owner','',true),
        set_config('app.notification_runtime_generation','',true),set_config('app.notification_org_generation','',true),set_config('app.notification_abandon_unstarted','',true),
        set_config('statement_timeout','3s',true),set_config('lock_timeout','250ms',true),
        set_config('idle_in_transaction_session_timeout','5s',true)`;
        const query = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
          const remaining = 3000 - (performance.now() - started);
          if (remaining <= 0) throw new NotificationWorkerUnavailable('deadline');
          await tx`select set_config('statement_timeout',${Math.max(1, Math.floor(remaining)) + 'ms'},true)`;
          const result = await operation();
          if (performance.now() - started >= 3000)
            throw new NotificationWorkerUnavailable('deadline');
          return result;
        };
        const [clock] = await query(
          () => tx<{ now: string }[]>`select clock_timestamp()::text as now`,
        );
        const now = Date.parse(clock.now);
        const checkedAt = new Date(now).toISOString();
        const [runtime] = await query(
          () => tx<RuntimeRow[]>`
        select generation::text,owner_id::text,lease_expires_at::text,last_heartbeat_at::text,started_at::text,stopped_at::text,
          build_sha,catalog_revision,catalog_sha256,projector_revision,projector_sha256,admission_generation::text,
          admission_checked_at::text,admission_code,admission_build_sha,admission_artifact_sha256,admission_catalog_revision,admission_catalog_sha256,admission_projector_revision,admission_projector_sha256
        from public.notification_worker_runtime where singleton and schema_version=1`,
        );
        if (!runtime) throw new NotificationSchedulerUnavailable('state_missing');
        const [control] = await query(
          () => tx<
            {
              last_completed_at: string | null;
              last_success_at: string | null;
              failure_streak: NotificationWorkerHealth['organization']['failureStreak'];
              last_failure_code: NotificationWorkerHealth['organization']['lastFailureCode'];
              last_result: NotificationWorkerHealth['organization']['lastResult'];
            }[]
          >`
        select last_completed_at::text,last_success_at::text,failure_streak,last_failure_code,last_result
        from public.notification_org_control where organization_id=${organizationId}::uuid`,
        );
        const readQueue = async (state: 'pending' | 'processing'): Promise<Queue> => {
          const [count] = await query(() =>
            state === 'pending'
              ? tx<
                  { count: number }[]
                >`select count(*)::int as count from(select event_id from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending' order by enqueued_at,event_id limit 5001) bounded`
              : tx<
                  { count: number }[]
                >`select count(*)::int as count from(select event_id from public.notification_outbox where organization_id=${organizationId}::uuid and state='processing' order by enqueued_at,event_id limit 5001) bounded`,
          );
          const [oldest] = await query(() =>
            state === 'pending'
              ? tx<
                  { enqueued_at: string }[]
                >`select enqueued_at::text from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending' order by notification_outbox.enqueued_at,event_id limit 1`
              : tx<
                  { enqueued_at: string }[]
                >`select enqueued_at::text from public.notification_outbox where organization_id=${organizationId}::uuid and state='processing' order by notification_outbox.enqueued_at,event_id limit 1`,
          );
          return {
            count: Math.min(5000, count.count),
            lowerBound: count.count > 5000,
            oldest: age(now, oldest?.enqueued_at ?? null),
          };
        };
        const pending = await readQueue('pending');
        const processing = await readQueue('processing');
        // The installed worker currently supports exactly this single catalog.
        // Complement seeks use its partial index even when 100000 supported rows exist.
        const [before] = await query(
          () =>
            tx<
              { found: boolean }[]
            >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending' and catalog_revision<${NOTIFICATION_CATALOG_REVISION} collate "C" limit 1) as found`,
        );
        const [after] = before.found
          ? [{ found: false }]
          : await query(
              () =>
                tx<
                  { found: boolean }[]
                >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending' and catalog_revision>${NOTIFICATION_CATALOG_REVISION} collate "C" limit 1) as found`,
            );
        const heartbeat = age(now, runtime.last_heartbeat_at);
        const identity =
          runtime.build_sha &&
          runtime.catalog_revision &&
          runtime.catalog_sha256 &&
          runtime.projector_revision &&
          runtime.projector_sha256
            ? {
                buildSha: runtime.build_sha,
                catalogRevision: runtime.catalog_revision,
                catalogSha256: runtime.catalog_sha256,
                projectorRevision: runtime.projector_revision,
                projectorSha256: runtime.projector_sha256,
              }
            : null;
        const admission =
          runtime.admission_code && runtime.admission_checked_at
            ? {
                checked: age(now, runtime.admission_checked_at),
                code: runtime.admission_code,
                buildSha: runtime.admission_build_sha,
                artifactSha256: runtime.admission_artifact_sha256,
                catalogRevision: runtime.admission_catalog_revision,
                catalogSha256: runtime.admission_catalog_sha256,
                projectorRevision: runtime.admission_projector_revision,
                projectorSha256: runtime.admission_projector_sha256,
              }
            : null;
        const live =
          runtime.owner_id !== null &&
          runtime.lease_expires_at !== null &&
          Date.parse(runtime.lease_expires_at) > now;
        let state: NotificationWorkerHealth['state'];
        if (live) {
          if (heartbeat.ageMs === null || heartbeat.ageMs > 15000 || identity === null)
            state = 'stale';
          else if (
            identity.catalogRevision !== NOTIFICATION_CATALOG_REVISION ||
            identity.catalogSha256 !==
              createHash('sha256').update(notificationCatalogManifest()).digest('hex')
          )
            state = 'catalog_mismatch';
          else state = 'runnable';
        } else if (
          admission !== null &&
          admission.checked.ageMs !== null &&
          admission.checked.ageMs <= 90000
        )
          state = admission.code;
        else
          state =
            runtime.generation !== '0' || runtime.admission_generation !== '0' ? 'stale' : 'absent';
        return {
          checkedAt,
          state,
          worker: { heartbeat, identity, admission },
          organization: {
            lastCompleted: age(now, control?.last_completed_at ?? null),
            lastSuccess: age(now, control?.last_success_at ?? null),
            failureStreak: control?.failure_streak ?? 0,
            lastFailureCode: control?.last_failure_code ?? null,
            lastResult: control?.last_result ?? null,
          },
          queue: { pending, processing, unsupportedCatalogPending: before.found || after.found },
        };
      },
    )) as NotificationWorkerHealth;
    recordNotificationMetric(
      'health',
      health.state,
      performance.now() - started,
      health.queue.pending.count,
      health.queue.pending.lowerBound,
    );
    return health;
  } catch (error) {
    recordNotificationMetric('health', 'failed', performance.now() - started);
    const failure = notificationWorkerFailure(error);
    if (!failure) {
      reportNotificationLoopFailure(error);
      throw error;
    }
    reportNotificationWorkerFailure(failure);
    throw failure;
  }
}
