import { UUID_PATTERN } from '$lib/notifications/fields';
import {
  NOTIFICATION_PROJECTION_KIND,
  NOTIFICATION_PROJECTION_SUPPORT,
  notificationProjectionSupportKey,
} from '$lib/notifications/projection-manifest';
import type { ClaimedNotificationEvent } from '../outbox-claim';
import {
  assertOrganizationLease,
  assertRuntimeLease,
  type OrganizationLease,
  type RuntimeLease,
} from '../scheduler/contracts';

export type ProjectionScope = Readonly<{
  runtime: RuntimeLease;
  organization: OrganizationLease;
  event: ClaimedNotificationEvent;
}>;

export type RevalidationScope = Readonly<{
  organizationId: string;
  candidateId: string;
  recipientProfileId: string;
  authoritySha256: string;
}>;

const PRODUCTION_KEYS = new Set(
  NOTIFICATION_PROJECTION_SUPPORT.map(notificationProjectionSupportKey),
);

function validInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function assertProjectionScope(scope: ProjectionScope): void {
  assertRuntimeLease(scope.runtime);
  assertOrganizationLease(scope.organization, scope.runtime);
  const { event } = scope;
  if (
    event.organization_id !== scope.organization.organizationId ||
    event.lease.eventId !== event.id ||
    event.lease.ownerId !== scope.runtime.ownerId ||
    !/^[1-9][0-9]{0,18}$/.test(event.lease.generation) ||
    BigInt(event.lease.generation) > 9223372036854775807n ||
    !validInstant(event.lease.expiresAt) ||
    !validInstant(event.lease.hardDeadline) ||
    !PRODUCTION_KEYS.has(
      notificationProjectionSupportKey({
        catalogRevision: event.catalog_revision,
        kind: event.kind as (typeof NOTIFICATION_PROJECTION_SUPPORT)[number]['kind'],
        schemaVersion: event.schema_version,
        adapterRevision: 'scope-validation',
      }),
    )
  ) {
    throw new Error('Invalid notification projection scope');
  }
}

export function assertRevalidationScope(scope: RevalidationScope): void {
  if (
    !UUID_PATTERN.test(scope.organizationId) ||
    !UUID_PATTERN.test(scope.candidateId) ||
    !UUID_PATTERN.test(scope.recipientProfileId) ||
    !/^[a-f0-9]{64}$/.test(scope.authoritySha256)
  ) {
    throw new Error('Invalid notification revalidation scope');
  }
}

export function projectionKind(): typeof NOTIFICATION_PROJECTION_KIND {
  return NOTIFICATION_PROJECTION_KIND;
}
