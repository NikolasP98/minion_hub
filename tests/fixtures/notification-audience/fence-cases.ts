import { expect } from 'vitest';
import { projectNotificationAudience } from '$server/services/notifications/projection/transaction';
import {
  completeOrganizationLease,
  renewOrganizationLease,
} from '$server/services/notifications/scheduler/organization-lease';
import {
  heartbeatRuntimeLease,
  releaseRuntimeLease,
} from '$server/services/notifications/scheduler/runtime-lease';
import {
  resetNotificationAudienceOperationalState,
  type NotificationAudienceHarness,
} from './postgres-harness';
import { acquireScope, type ActiveProjection } from './runtime-cases';

async function projectionRows(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
): Promise<unknown> {
  return harness.owner`select
    (select count(*)::integer from public.notification_projection_receipts
      where event_id=${active.event.id}::uuid) as receipts,
    (select count(*)::integer from public.notification_audience_candidates
      where event_id=${active.event.id}::uuid) as candidates,
    (select state from public.notification_outbox where event_id=${active.event.id}::uuid) as state`;
}

async function removeAbandonedFixtureOperation(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
): Promise<void> {
  await harness.owner.begin(async (tx) => {
    const [identity] = await tx<{ database: string; marker: string | null }[]>`
      select current_database() as database,
        shobj_description(oid,'pg_database') as marker
      from pg_database where datname=current_database()`;
    if (
      !identity?.database.startsWith('minion_qc_notification_') ||
      identity.marker !== 'minion-notification-reconciliation-child:v1'
    ) {
      throw new Error('Abandoned notification cleanup requires the marked disposable child');
    }
    await tx`alter table public.notification_outbox disable trigger user`;
    const outbox = await tx`
      delete from public.notification_outbox
      where organization_id=${active.event.organization_id}::uuid
        and event_id=${active.event.id}::uuid and state='processing'
        and lease_owner=${active.event.lease.ownerId}::uuid
        and generation=${active.event.lease.generation}::bigint`;
    await tx`alter table public.notification_outbox enable trigger user`;
    await tx`alter table public.notification_events disable trigger user`;
    const event = await tx`
      delete from public.notification_events
      where organization_id=${active.event.organization_id}::uuid and id=${active.event.id}::uuid`;
    await tx`alter table public.notification_events enable trigger user`;
    if (outbox.count !== 1 || event.count !== 1) {
      throw new Error('Abandoned notification cleanup did not match one exact operation tuple');
    }
  });
}

export async function verifyFixtureCleanupBoundary(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 137, 'join.requested');
  const database = harness.child.name;
  if (!/^minion_qc_notification_[a-f0-9]{24}$/.test(database)) {
    throw new Error('Unexpected disposable child database name');
  }
  await harness.owner.unsafe(`comment on database "${database}" is 'not-a-disposable-child'`);
  try {
    await expect(removeAbandonedFixtureOperation(harness, active)).rejects.toThrow(
      'marked disposable child',
    );
    expect(await projectionRows(harness, active)).toEqual([
      { receipts: 0, candidates: 0, state: 'processing' },
    ]);
  } finally {
    await harness.owner.unsafe(
      `comment on database "${database}" is 'minion-notification-reconciliation-child:v1'`,
    );
  }
  await removeAbandonedFixtureOperation(harness, active);
}

async function withHeldRow(
  harness: NotificationAudienceHarness,
  lock: (tx: import('postgres').TransactionSql) => Promise<unknown>,
  callback: () => Promise<void>,
): Promise<void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const blocker = harness.competitor.begin(async (tx) => {
    await lock(tx);
    acquired();
    await held;
  });
  await ready;
  try {
    await callback();
  } finally {
    release();
    await blocker;
  }
}

export async function verifyFinalizerLockTimeouts(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await harness.worker`set jit=on`;
  const active = await acquireScope(harness, 131, 'join.requested');
  const locks = [
    (tx: import('postgres').TransactionSql) =>
      tx`select singleton from public.notification_worker_runtime where singleton for update`,
    (tx: import('postgres').TransactionSql) =>
      tx`select organization_id from public.notification_org_control
        where organization_id=${active.fixture.organizationId}::uuid for update`,
    (tx: import('postgres').TransactionSql) =>
      tx`select event_id from public.notification_outbox
        where event_id=${active.event.id}::uuid for update`,
  ] as const;
  for (const lock of locks) {
    await withHeldRow(harness, lock, async () => {
      await expect(
        projectNotificationAudience(active, new AbortController().signal),
      ).rejects.toMatchObject({ code: '55P03' });
    });
    expect(await projectionRows(harness, active)).toEqual([
      { receipts: 0, candidates: 0, state: 'processing' },
    ]);
    expect(await harness.worker<{ jit: string }[]>`select current_setting('jit') as jit`).toEqual([
      { jit: 'on' },
    ]);
  }
}

export async function verifyProjectionJitIsTransactionLocal(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await harness.worker`set jit=on`;
  const active = await acquireScope(harness, 135, 'join.requested');
  await expect(
    projectNotificationAudience(active, new AbortController().signal),
  ).resolves.toMatchObject({
    outcome: 'projected',
  });
  // The worker pool has max=1, so this is the same physical connection after COMMIT.
  // Projection's set_config(..., true) must not leak into the next borrower.
  expect(await harness.worker<{ jit: string }[]>`select current_setting('jit') as jit`).toEqual([
    { jit: 'on' },
  ]);
}

export async function verifyReplacementWinsBeforeProjection(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const runtimeLost = await acquireScope(harness, 132, 'join.requested');
  expect(await releaseRuntimeLease(runtimeLost.runtime)).toBe(true);
  await expect(
    projectNotificationAudience(runtimeLost, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'notification_projection_unavailable',
    reason: 'scope_lost',
  });
  expect(await projectionRows(harness, runtimeLost)).toEqual([
    { receipts: 0, candidates: 0, state: 'processing' },
  ]);
  await removeAbandonedFixtureOperation(harness, runtimeLost);

  await resetNotificationAudienceOperationalState(harness);
  const organizationLost = await acquireScope(harness, 133, 'join.requested');
  expect(
    await completeOrganizationLease(organizationLost.runtime, organizationLost.organization, {
      result: 'completed',
    }),
  ).toBe(true);
  await expect(
    projectNotificationAudience(organizationLost, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'notification_projection_unavailable',
    reason: 'scope_lost',
  });
  expect(await projectionRows(harness, organizationLost)).toEqual([
    { receipts: 0, candidates: 0, state: 'processing' },
  ]);
}

export async function verifySameGenerationRenewalBeforeProjection(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 134, 'join.requested');
  const runtime = await heartbeatRuntimeLease(active.runtime);
  expect(runtime).not.toBeNull();
  const organization = await renewOrganizationLease(runtime!, active.organization);
  expect(organization).not.toBeNull();
  const renewed = Object.freeze({ ...active, runtime: runtime!, organization: organization! });
  expect(await projectNotificationAudience(renewed, new AbortController().signal)).toMatchObject({
    outcome: 'projected',
  });
  expect(await projectionRows(harness, renewed)).toEqual([
    { receipts: 1, candidates: 1, state: 'projected' },
  ]);
}
