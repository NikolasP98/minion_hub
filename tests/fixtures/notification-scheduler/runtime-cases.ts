import { expect } from 'vitest';
import {
  acquireRuntimeLease,
  heartbeatRuntimeLease,
  publishAdmissionObservation,
  releaseRuntimeLease,
} from '$server/services/notifications/scheduler/runtime-lease';
import {
  completeOrganizationLease,
  renewOrganizationLease,
} from '$server/services/notifications/scheduler/organization-lease';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
import { withCoordinator } from '$server/services/notifications/scheduler/transaction';
import type {
  RuntimeIdentity,
  RuntimeLease,
} from '$server/services/notifications/scheduler/contracts';
import { NotificationWorkerUnavailable } from '$server/services/notifications/worker-failure';
import { NOTIFICATION_PROJECTION_SUPPORT } from '$lib/notifications/projection-manifest';
import { OUTBOX_ORG_A, OUTBOX_ORG_B } from '../notification-outbox/postgres-harness';
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  deferred,
  insertRawEvent,
} from '../notification-outbox/runtime-harness';
import {
  type NotificationSchedulerHarness,
  withSchedulerFixtureMaintenance,
} from './postgres-harness';

export const SCHEDULER_OWNER_A = '70000000-0000-4000-8000-0000000000a1';
export const SCHEDULER_OWNER_B = '70000000-0000-4000-8000-0000000000b2';
export const SCHEDULER_SUPPORT = NOTIFICATION_PROJECTION_SUPPORT;

export function schedulerIdentity(
  ownerId = SCHEDULER_OWNER_A,
  overrides: Partial<RuntimeIdentity> = {},
): RuntimeIdentity {
  return Object.freeze({
    ownerId,
    buildSha: 'a'.repeat(40),
    catalogRevision: CURRENT_CATALOG_REVISION,
    catalogSha256: 'b'.repeat(64),
    projectorRevision: 'qualification-only.1',
    projectorSha256: 'c'.repeat(64),
    ...overrides,
  });
}

export async function acquireSchedulerRuntime(
  identity = schedulerIdentity(),
): Promise<RuntimeLease> {
  const result = await acquireRuntimeLease(identity);
  expect(result.state).toBe('acquired');
  if (result.state !== 'acquired')
    throw new Error('Notification scheduler runtime was not acquired');
  return result.lease;
}

async function insertPending(
  harness: NotificationSchedulerHarness,
  organizationId: string,
  key: string,
) {
  return asApplicationRole(harness.source, organizationId, (tx) =>
    insertRawEvent(tx, { organizationId, dedupeKey: key }),
  );
}

async function connectionState(harness: NotificationSchedulerHarness) {
  const [row] = await harness.worker<
    {
      role: string;
      organizationId: string;
      runtimeOwner: string;
      runtimeGeneration: string;
      organizationGeneration: string;
      statementTimeout: string;
      lockTimeout: string;
      idleTimeout: string;
    }[]
  >`select current_user as role,
    current_setting('app.current_org_id',true) as "organizationId",
    current_setting('app.notification_runtime_owner',true) as "runtimeOwner",
    current_setting('app.notification_runtime_generation',true) as "runtimeGeneration",
    current_setting('app.notification_org_generation',true) as "organizationGeneration",
    current_setting('statement_timeout') as "statementTimeout",
    current_setting('lock_timeout') as "lockTimeout",
    current_setting('idle_in_transaction_session_timeout') as "idleTimeout"`;
  return row;
}

export async function verifyRuntimeLeaseOwnership(harness: NotificationSchedulerHarness) {
  const first = await acquireSchedulerRuntime();
  expect(first.generation).toBe('1');
  const standby = await acquireRuntimeLease(schedulerIdentity(SCHEDULER_OWNER_B));
  expect(standby).toEqual({
    state: 'standby',
    retryAfterMs: expect.toSatisfy((value: number) => value >= 1000 && value <= 5000),
  });

  const heartbeat = await heartbeatRuntimeLease(first);
  expect(heartbeat?.generation).toBe('1');
  expect(Date.parse(heartbeat?.expiresAt ?? '')).toBeGreaterThan(Date.parse(first.expiresAt));

  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`with stamp as materialized(select clock_timestamp() as value)
      update public.notification_worker_runtime
      set last_heartbeat_at=stamp.value-interval '40 seconds',
        lease_expires_at=stamp.value-interval '10 seconds'
      from stamp where singleton`;
  });
  const replacement = await acquireSchedulerRuntime(schedulerIdentity(SCHEDULER_OWNER_B));
  expect(replacement.generation).toBe('2');
  expect(await heartbeatRuntimeLease(first)).toBeNull();
  expect(await releaseRuntimeLease(first)).toBe(false);
  expect(await releaseRuntimeLease(replacement)).toBe(true);
  expect(
    await harness.owner`select generation::text,owner_id,lease_expires_at,stopped_at is not null as stopped
      from public.notification_worker_runtime`,
  ).toEqual([{ generation: '2', owner_id: null, lease_expires_at: null, stopped: true }]);
}

export async function verifyAdmissionObservationOwnership(harness: NotificationSchedulerHarness) {
  const first = Object.freeze({
    ownerId: SCHEDULER_OWNER_A,
    code: 'projection_unavailable' as const,
    buildSha: 'a'.repeat(40),
    artifactSha256: null,
    catalogRevision: CURRENT_CATALOG_REVISION,
    catalogSha256: 'b'.repeat(64),
    projectorRevision: null,
    projectorSha256: null,
  });
  expect(await publishAdmissionObservation(first)).toBe(true);
  expect(await publishAdmissionObservation({ ...first, ownerId: SCHEDULER_OWNER_B })).toBe(false);

  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_worker_runtime
      set admission_checked_at=clock_timestamp()-interval '31 seconds' where singleton`;
  });
  const lease = await acquireSchedulerRuntime();
  expect(await publishAdmissionObservation({ ...first, ownerId: SCHEDULER_OWNER_B })).toBe(false);
  expect(await releaseRuntimeLease(lease)).toBe(true);
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_worker_runtime
      set admission_checked_at=clock_timestamp()-interval '31 seconds' where singleton`;
  });
  expect(
    await publishAdmissionObservation({
      ...first,
      ownerId: SCHEDULER_OWNER_B,
      code: 'catalog_mismatch',
      artifactSha256: 'd'.repeat(64),
    }),
  ).toBe(true);
  expect(
    await harness.owner`select admission_generation::text,admission_owner_id::text,
      admission_code,admission_build_sha,admission_artifact_sha256,
      admission_catalog_revision,admission_catalog_sha256,
      admission_projector_revision,admission_projector_sha256
      from public.notification_worker_runtime`,
  ).toEqual([
    {
      admission_generation: '2',
      admission_owner_id: SCHEDULER_OWNER_B,
      admission_code: 'catalog_mismatch',
      admission_build_sha: 'a'.repeat(40),
      admission_artifact_sha256: 'd'.repeat(64),
      admission_catalog_revision: CURRENT_CATALOG_REVISION,
      admission_catalog_sha256: 'b'.repeat(64),
      admission_projector_revision: null,
      admission_projector_sha256: null,
    },
  ]);
}

async function whileRuntimeRowHeld<T>(
  harness: NotificationSchedulerHarness,
  operation: () => Promise<T>,
) {
  const locked = deferred();
  const release = deferred();
  const holder = harness.competitor.begin(async (tx) => {
    await tx`select singleton from public.notification_worker_runtime where singleton for update`;
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const releaseTimer = setTimeout(release.resolve, 550);
  try {
    return await operation();
  } finally {
    clearTimeout(releaseTimer);
    release.resolve();
    await holder;
  }
}

export async function verifyHeldRuntimeContention(harness: NotificationSchedulerHarness) {
  await insertPending(harness, OUTBOX_ORG_A, 'scheduler-held-runtime');
  let runtime = await acquireSchedulerRuntime();
  const heartbeat = await whileRuntimeRowHeld(harness, () => heartbeatRuntimeLease(runtime));
  expect(heartbeat).not.toBeNull();
  runtime = heartbeat!;

  const discovered = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(discovered.leases).toHaveLength(1);
  const renewed = await whileRuntimeRowHeld(harness, () =>
    renewOrganizationLease(runtime, discovered.leases[0]),
  );
  expect(renewed).not.toBeNull();
  expect(renewed?.expiresAt).toBe(discovered.leases[0].hardDeadline);

  const completed = await whileRuntimeRowHeld(harness, () =>
    completeOrganizationLease(runtime, renewed!, { result: 'completed' }),
  );
  expect(completed).toBe(true);
  expect(
    await harness.owner`select state,last_result,generation::text from public.notification_org_control
      where organization_id=${OUTBOX_ORG_A}::uuid`,
  ).toEqual([{ state: 'idle', last_result: 'completed', generation: '1' }]);
}

export async function verifyOrganizationLeaseFencing(harness: NotificationSchedulerHarness) {
  await insertPending(harness, OUTBOX_ORG_A, 'scheduler-org-a');
  const runtime = await acquireSchedulerRuntime();
  const discovered = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(discovered.state).toBe('claimed');
  expect(discovered.leases).toHaveLength(1);
  const first = discovered.leases[0];
  expect(first.organizationId).toBe(OUTBOX_ORG_A);
  expect(first.generation).toBe('1');
  expect(Date.parse(first.hardDeadline) - Date.parse(first.expiresAt)).toBe(30_000);

  const renewed = await renewOrganizationLease(runtime, first);
  expect(renewed?.generation).toBe('1');
  expect(renewed?.expiresAt).toBe(first.hardDeadline);
  expect(await renewOrganizationLease(runtime, renewed!)).toBeNull();
  expect(
    await completeOrganizationLease(runtime, renewed!, {
      result: 'failed',
      reason: 'projection_failed',
    }),
  ).toBe(true);
  expect(
    await completeOrganizationLease(runtime, renewed!, {
      result: 'completed',
    }),
  ).toBe(false);
  expect(
    await harness.owner`select state,generation::text,failure_streak,last_failure_code,last_result,
      owner_id,lease_expires_at,next_due_at>last_completed_at as delayed
      from public.notification_org_control where organization_id=${OUTBOX_ORG_A}::uuid`,
  ).toEqual([
    {
      state: 'idle',
      generation: '1',
      failure_streak: 1,
      last_failure_code: 'projection_failed',
      last_result: 'failed',
      owner_id: null,
      lease_expires_at: null,
      delayed: true,
    },
  ]);

  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_org_control set next_due_at=clock_timestamp()-interval '1 second'
      where organization_id=${OUTBOX_ORG_A}::uuid`;
  });
  const second = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(second.leases).toHaveLength(1);
  expect(second.leases[0].generation).toBe('2');
  expect(await completeOrganizationLease(runtime, second.leases[0], { result: 'completed' })).toBe(
    true,
  );
  expect(
    await harness.owner`select failure_streak,last_failure_code,last_result,
      last_success_at=last_completed_at as success from public.notification_org_control
      where organization_id=${OUTBOX_ORG_A}::uuid`,
  ).toEqual([
    {
      failure_streak: 0,
      last_failure_code: null,
      last_result: 'completed',
      success: true,
    },
  ]);
  expect(
    await completeOrganizationLease(
      runtime,
      { ...second.leases[0], organizationId: OUTBOX_ORG_B },
      { result: 'completed' },
    ),
  ).toBe(false);
}

export async function verifyCoordinatorPoolRestoration(harness: NotificationSchedulerHarness) {
  const runtime = await acquireSchedulerRuntime();
  await expect(
    withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
      await tx`select 1`;
      throw new Error('scheduler fixture callback failed');
    }),
  ).rejects.toThrow('scheduler fixture callback failed');
  expect(await connectionState(harness)).toEqual({
    role: 'minion_qc',
    organizationId: '',
    runtimeOwner: '',
    runtimeGeneration: '',
    organizationGeneration: '',
    statementTimeout: '30s',
    lockTimeout: '0',
    idleTimeout: '0',
  });

  const timeout = await withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
    await tx`select set_config('statement_timeout','25ms',true)`;
    await tx`select pg_sleep(0.1)`;
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(timeout).toBeInstanceOf(NotificationWorkerUnavailable);
  expect(timeout).toMatchObject({
    code: 'notification_worker_unavailable',
    reason: 'statement_timeout',
  });
  expect(await connectionState(harness)).toEqual({
    role: 'minion_qc',
    organizationId: '',
    runtimeOwner: '',
    runtimeGeneration: '',
    organizationGeneration: '',
    statementTimeout: '30s',
    lockTimeout: '0',
    idleTimeout: '0',
  });
}
