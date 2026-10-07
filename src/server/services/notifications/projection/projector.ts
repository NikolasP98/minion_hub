import { createHash } from 'node:crypto';
import { getRlsPgClient } from '$server/db/pg-pool';
import {
  NOTIFICATION_PROJECTION_REVISION,
  NOTIFICATION_PROJECTION_SUPPORT,
  notificationProjectionManifest,
} from '$lib/notifications/projection-manifest';
import {
  claimNotificationProjectionEventsInTransaction,
  type ClaimedNotificationEvent,
} from '../outbox-claim';
import { notificationIntegrityFailure } from '../event-integrity';
import {
  quarantineNotificationEventsInTransaction,
  renewNotificationEvent,
} from '../outbox-settlement';
import { withNotificationWorkerTransaction } from '../worker-transaction';
import type { NotificationProjector } from '../scheduler/projector-contract';
import {
  assertOrganizationLease,
  type OrganizationLease,
  type OrganizationResult,
  type RuntimeLease,
} from '../scheduler/contracts';
import { NotificationProjectionUnavailable } from './contracts';
import { reconcileNotificationProjection } from './reconcile';
import { projectNotificationAudience } from './transaction';

const PROJECTOR_MANIFEST = notificationProjectionManifest();
const PROJECTOR_SHA256 = createHash('sha256').update(PROJECTOR_MANIFEST).digest('hex');

function deadlineFailure(signal: AbortSignal): OrganizationResult {
  return Object.freeze({
    result: 'failed',
    reason: signal.aborted ? ('deadline' as const) : ('projection_failed' as const),
  });
}

function hasMargin(instant: string, milliseconds: number): boolean {
  const deadline = Date.parse(instant);
  return Number.isFinite(deadline) && deadline - Date.now() >= milliseconds;
}

type ProjectionClaimResult = Readonly<{
  event: ClaimedNotificationEvent | null;
  malformedSettled: boolean;
  unsupported: boolean;
  busy: boolean;
}>;

async function claimOne(
  runtime: RuntimeLease,
  organization: OrganizationLease,
): Promise<ProjectionClaimResult> {
  return (await getRlsPgClient().begin(async (tx) => {
    await tx`select
      set_config('role','notification_worker',true),
      set_config('app.current_org_id',${organization.organizationId},true),
      set_config('app.current_profile_id','',true),
      set_config('app.notification_scope_mode','projection_claim',true),
      set_config('app.notification_runtime_owner',${runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${runtime.generation},true),
      set_config('app.notification_org_generation',${organization.generation},true),
      set_config('app.notification_build_sha',${runtime.buildSha},true),
      set_config('app.notification_catalog_revision',${runtime.catalogRevision},true),
      set_config('app.notification_catalog_sha256',${runtime.catalogSha256},true),
      set_config('app.notification_projector_revision',${runtime.projectorRevision},true),
      set_config('app.notification_projector_sha256',${runtime.projectorSha256},true),
      set_config('app.notification_owner',${runtime.ownerId},true),
      set_config('app.notification_generation','',true),
      set_config('app.notification_event_id','',true),
      set_config('app.notification_quarantine_reason','',true),
      set_config('request.jwt.claim.sub','',true),
      set_config('request.jwt.claims','{}',true),
      set_config('statement_timeout','3s',true),
      set_config('lock_timeout','250ms',true),
      set_config('idle_in_transaction_session_timeout','5s',true)`;
    const batch = await claimNotificationProjectionEventsInTransaction(
      tx,
      { organizationId: organization.organizationId, ownerId: runtime.ownerId },
      NOTIFICATION_PROJECTION_SUPPORT,
      1,
    );
    const event = batch.events[0] ?? null;
    if (!event)
      return Object.freeze({
        event: null,
        malformedSettled: false,
        unsupported: batch.unsupportedCatalogPending === true,
        busy: batch.busy,
      });
    const reason = notificationIntegrityFailure(event);
    if (!reason)
      return Object.freeze({
        event,
        malformedSettled: false,
        unsupported: batch.unsupportedCatalogPending === true,
        busy: false,
      });
    const settled = await quarantineNotificationEventsInTransaction(
      tx,
      { organizationId: organization.organizationId, ownerId: runtime.ownerId },
      [{ lease: event.lease, reason }],
    );
    if (settled !== 1) throw new NotificationProjectionUnavailable('scope_lost');
    return Object.freeze({
      event: null,
      malformedSettled: true,
      unsupported: batch.unsupportedCatalogPending === true,
      busy: false,
    });
  })) as ProjectionClaimResult;
}

async function renewOrObserve(
  organization: OrganizationLease,
  event: ClaimedNotificationEvent,
): Promise<ClaimedNotificationEvent['lease'] | null> {
  const scope = { organizationId: organization.organizationId, ownerId: event.lease.ownerId };
  try {
    return await renewNotificationEvent(scope, event.lease);
  } catch {
    try {
      return await withNotificationWorkerTransaction(scope, async (tx) => {
        await tx`select set_config('app.notification_generation',${event.lease.generation},true)`;
        const [row] = await tx<
          { expires_at: string; hard_deadline: string }[]
        >`select to_char(lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
            to_char(hard_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as hard_deadline
          from public.notification_outbox
          where organization_id=${organization.organizationId}::uuid and event_id=${event.id}::uuid
            and state='processing' and lease_owner=${event.lease.ownerId}::uuid
            and generation=${event.lease.generation}::bigint and renewal_count=1
            and lease_expires_at=hard_deadline and lease_expires_at>clock_timestamp()`;
        return row
          ? Object.freeze({
              ...event.lease,
              expiresAt: row.expires_at,
              hardDeadline: row.hard_deadline,
            })
          : null;
      });
    } catch {
      return null;
    }
  }
}

async function projectPage(
  runtime: RuntimeLease,
  organization: OrganizationLease,
  signal: AbortSignal,
): Promise<OrganizationResult> {
  const started = performance.now();
  assertOrganizationLease(organization, runtime);
  if (
    signal.aborted ||
    organization.hardDeadlineMonotonic - started < 45_000 ||
    !hasMargin(organization.hardDeadline, 45_000)
  ) {
    return Object.freeze({ result: 'failed', reason: 'deadline' });
  }
  let claimed;
  try {
    claimed = await claimOne(runtime, organization);
  } catch (error) {
    return error instanceof NotificationProjectionUnavailable && error.reason === 'deadline'
      ? Object.freeze({ result: 'failed', reason: 'deadline' })
      : deadlineFailure(signal);
  }
  if (claimed.malformedSettled) return Object.freeze({ result: 'completed' });
  if (!claimed.event) {
    if (claimed.busy) return Object.freeze({ result: 'failed', reason: 'projection_failed' });
    return Object.freeze({ result: claimed.unsupported ? 'unsupported' : 'empty' });
  }
  const scope = { runtime, organization, event: claimed.event } as const;
  if (signal.aborted) return Object.freeze({ result: 'failed', reason: 'deadline' });
  const renewed = await renewOrObserve(organization, claimed.event);
  if (!renewed || !hasMargin(renewed.hardDeadline, 45_000))
    return Object.freeze({ result: 'failed', reason: 'projection_failed' });
  const renewedScope = { ...scope, event: { ...scope.event, lease: renewed } } as const;
  try {
    await projectNotificationAudience(renewedScope, signal, started);
    return Object.freeze({ result: 'completed' });
  } catch (error) {
    const observation = await reconcileNotificationProjection(renewedScope);
    if (observation === 'committed' || observation === 'quarantined')
      return Object.freeze({ result: 'completed' });
    if (error instanceof NotificationProjectionUnavailable && error.reason === 'deadline')
      return Object.freeze({ result: 'failed', reason: 'deadline' });
    return deadlineFailure(signal);
  }
}

export function productionNotificationProjector(): NotificationProjector {
  return Object.freeze({
    revision: NOTIFICATION_PROJECTION_REVISION,
    sha256: PROJECTOR_SHA256,
    supportedProjectionTuples: NOTIFICATION_PROJECTION_SUPPORT,
    projectPage,
  });
}
