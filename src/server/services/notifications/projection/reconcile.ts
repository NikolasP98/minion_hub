import { getRlsPgClient } from '$server/db/pg-pool';
import { NOTIFICATION_PROJECTION_KIND } from '$lib/notifications/projection-manifest';
import { PROJECTION_OBSERVATIONS, type ProjectionObservation } from './contracts';
import { assertProjectionScope, type ProjectionScope } from './fence';

const OBSERVATIONS = new Set<string>(PROJECTION_OBSERVATIONS);

/** Observe one exact claim after an ambiguous finalizer/COMMIT response. Never retries projection. */
export async function reconcileNotificationProjection(
  scope: ProjectionScope,
): Promise<ProjectionObservation> {
  assertProjectionScope(scope);
  try {
    return (await getRlsPgClient().begin(async (tx) => {
      const [setup] = await tx<{ identity_cleared: boolean }[]>`
        select
          set_config('role','app_notification_worker',true),
          set_config('app.current_org_id',${scope.event.organization_id},true),
          set_config('app.current_profile_id','',true),
          set_config('app.notification_scope_mode','projection_reconcile',true),
          set_config('app.notification_owner',${scope.event.lease.ownerId},true),
          set_config('app.notification_generation',${scope.event.lease.generation},true),
          set_config('app.notification_event_id',${scope.event.id},true),
          set_config('app.notification_event_catalog_revision',${scope.event.catalog_revision},true),
          set_config('app.notification_event_kind',${scope.event.kind},true),
          set_config('app.notification_event_schema_version',${scope.event.schema_version.toString()},true),
          set_config('app.notification_projection_kind',${NOTIFICATION_PROJECTION_KIND},true),
          set_config('app.notification_runtime_owner','',true),
          set_config('app.notification_runtime_generation','',true),
          set_config('app.notification_org_generation','',true),
          set_config('app.notification_build_sha','',true),
          set_config('app.notification_catalog_revision','',true),
          set_config('app.notification_catalog_sha256','',true),
          set_config('app.notification_projector_revision','',true),
          set_config('app.notification_projector_sha256','',true),
          set_config('app.notification_candidate_id','',true),
          set_config('app.notification_recipient_profile_id','',true),
          set_config('app.notification_authority_sha256','',true),
          set_config('request.jwt.claim.sub','',true),
          set_config('request.jwt.claims','{}',true),
          set_config('statement_timeout','3s',true),
          set_config('lock_timeout','250ms',true),
          set_config('idle_in_transaction_session_timeout','5s',true),
          auth.uid() is null as identity_cleared`;
      if (!setup?.identity_cleared) return 'integrity_failed' as const;
      const [row] = await tx<{ observation: string }[]>`
        select public.notification_observe_audience() as observation`;
      return OBSERVATIONS.has(row?.observation ?? '')
        ? (row!.observation as ProjectionObservation)
        : ('integrity_failed' as const);
    })) as ProjectionObservation;
  } catch {
    return 'unavailable';
  }
}
