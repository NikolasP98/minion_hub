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
  }
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
