import { expect } from 'vitest';
import {
  abandonUnstartedOrganizationLease,
  completeOrganizationLease,
  isOrganizationLeaseLive,
} from '$server/services/notifications/scheduler/organization-lease';
import { NotificationCoordinatorBusy } from '$server/services/notifications/scheduler/contention';
import { releaseRuntimeLease } from '$server/services/notifications/scheduler/runtime-lease';
import { NotificationWorkerUnavailable } from '$server/services/notifications/worker-failure';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
import { withCoordinator } from '$server/services/notifications/scheduler/transaction';
import {
  asApplicationRole,
  deferred,
  fixtureUuid,
  insertRawEvent,
  withOutboxFixtureMaintenance,
} from '../notification-outbox/runtime-harness';
import type { NotificationSchedulerHarness } from './postgres-harness';
import { SCHEDULER_SUPPORT, acquireSchedulerRuntime } from './runtime-cases';
import { withSchedulerFixtureMaintenance } from './postgres-harness';

async function waitForBlockedOutboxSeek(harness: NotificationSchedulerHarness) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await harness.owner<{ blocked: boolean }[]>`
      select exists(
        select 1 from pg_stat_activity
        where datname=current_database()
          and application_name='notification-outbox-worker'
          and wait_event_type='Lock'
          and query ilike '%notification_outbox%'
      ) as blocked`;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Notification discovery never reached the blocked outbox seek');
}

async function addPending(
  harness: NotificationSchedulerHarness,
  organizationId: string,
  sequence: number,
) {
  await harness.owner`insert into public.organizations(id) values(${organizationId}::uuid)
    on conflict do nothing`;
  return asApplicationRole(harness.source, organizationId, (tx) =>
    insertRawEvent(tx, {
      organizationId,
      dedupeKey: `scheduler-discovery-${sequence}`,
      sourceIdentity: `scheduler-discovery-source-${sequence}`,
      subjectRevision: `scheduler-discovery-revision-${sequence}`,
    }),
  );
}

async function makeProcessing(
  harness: NotificationSchedulerHarness,
  eventId: string,
  expired: boolean,
) {
  await withOutboxFixtureMaintenance(harness, async (tx) => {
    await tx`with stamp as materialized(select clock_timestamp() as value)
      update public.notification_outbox set state='processing',lease_owner=${fixtureUuid(900, 9)}::uuid,
        generation=1,claim_count=1,claimed_at=stamp.value-interval '40 seconds',
        hard_deadline=stamp.value+interval '20 seconds',renewal_count=0,
        lease_expires_at=case when ${expired} then stamp.value-interval '5 seconds'
          else stamp.value+interval '15 seconds' end
      from stamp where event_id=${eventId}::uuid`;
  });
}

async function retireOrganizations(
  harness: NotificationSchedulerHarness,
  organizationIds: readonly string[],
) {
  await withOutboxFixtureMaintenance(harness, async (tx) => {
    await tx`update public.notification_outbox set state='projected',lease_owner=null,
      generation=greatest(generation,1),claim_count=greatest(claim_count,1),claimed_at=null,
      hard_deadline=null,lease_expires_at=null,renewal_count=null,completed_at=clock_timestamp(),
      quarantine_reason=null where organization_id=any(${[...organizationIds]}::uuid[])`;
  });
}

export async function verifyDiscoveryFairnessAndCapacity(harness: NotificationSchedulerHarness) {
  const organizations = Array.from({ length: 10 }, (_, index) => fixtureUuid(100 + index, 8));
  for (const [index, organizationId] of organizations.entries()) {
    const eventId = await addPending(harness, organizationId, index + 1);
    if (index === 1 || index === 7) await makeProcessing(harness, eventId, true);
    if (index === 3) await makeProcessing(harness, eventId, false);
  }

  const runtime = await acquireSchedulerRuntime();
  const first = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT, 4);
  expect(first.state).toBe('claimed');
  expect(first.leases.length).toBeGreaterThan(0);
  expect(first.leases.length).toBeLessThanOrEqual(4);
  expect(first.candidates).toBeLessThanOrEqual(16);
  expect(new Set(first.leases.map((lease) => lease.organizationId)).size).toBe(first.leases.length);
  expect(
    await harness.owner<{ state: string }[]>`
      select distinct o.state from public.notification_outbox o
      where o.organization_id=any(${first.leases.map((lease) => lease.organizationId)}::uuid[])
      order by o.state`,
  ).toEqual([{ state: 'pending' }, { state: 'processing' }]);
  for (const lease of first.leases) {
    expect(await completeOrganizationLease(runtime, lease, { result: 'completed' })).toBe(true);
  }
  await retireOrganizations(
    harness,
    first.leases.map((lease) => lease.organizationId),
  );

  const second = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT, 4);
  expect(second.leases.length).toBeGreaterThan(0);
  expect(second.leases.length).toBeLessThanOrEqual(4);
  expect(second.candidates).toBeLessThanOrEqual(16);
  expect(
    second.leases.every(
      (lease) =>
        !first.leases.some((firstLease) => firstLease.organizationId === lease.organizationId),
    ),
  ).toBe(true);
  expect(
    await harness.owner`
      select tick_generation::text,next_state from public.notification_scheduler_cursor`,
  ).toEqual([{ tick_generation: '2', next_state: 'pending' }]);
}

export async function verifyDiscoverySkipsHeldRows(harness: NotificationSchedulerHarness) {
  const organizationId = fixtureUuid(501, 8);
  await addPending(harness, organizationId, 501);
  const runtime = await acquireSchedulerRuntime();

  const cursorLocked = deferred();
  const releaseCursor = deferred();
  const cursorHolder = harness.competitor.begin(async (tx) => {
    await tx`select set_config('role','notification_coordinator',true),
      set_config('app.notification_runtime_owner',${runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${runtime.generation},true)`;
    await tx`select singleton from public.notification_scheduler_cursor where singleton for update`;
    cursorLocked.resolve();
    await releaseCursor.promise;
  });
  await cursorLocked.promise;
  expect(await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT)).toEqual({
    state: 'coordinator_busy',
    leases: [],
    candidates: 0,
  });
  releaseCursor.resolve();
  await cursorHolder;

  await withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
    await tx`insert into public.notification_org_control(organization_id)
      values(${organizationId}::uuid) on conflict do nothing`;
  });
  const controlLocked = deferred();
  const releaseControl = deferred();
  const controlHolder = harness.competitor.begin(async (tx) => {
    await tx`select set_config('role','notification_coordinator',true),
      set_config('app.notification_runtime_owner',${runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${runtime.generation},true)`;
    await tx`select organization_id from public.notification_org_control
      where organization_id=${organizationId}::uuid for update`;
    controlLocked.resolve();
    await releaseControl.promise;
  });
  await controlLocked.promise;
  const skipped = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(skipped.state).toBe('idle');
  expect(skipped.leases).toHaveLength(0);
  releaseControl.resolve();
  await controlHolder;

  const revisited: string[] = [];
  for (let tick = 0; tick < 6 && revisited.length === 0; tick++) {
    const result = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
    revisited.push(...result.leases.map((lease) => lease.organizationId));
  }
  expect(revisited).toContain(organizationId);
}

export async function verifyDiscoveryAbortAndAbandon(harness: NotificationSchedulerHarness) {
  const organizationId = fixtureUuid(601, 8);
  await addPending(harness, organizationId, 601);
  const runtime = await acquireSchedulerRuntime();

  const cancelled = new AbortController();
  cancelled.abort(new Error('qualification cancellation'));
  const aborted = await discoverNotificationOrganizations(
    runtime,
    SCHEDULER_SUPPORT,
    4,
    cancelled.signal,
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(aborted).toBeInstanceOf(NotificationWorkerUnavailable);
  expect(aborted).toMatchObject({
    code: 'notification_worker_unavailable',
    reason: 'deadline',
  });
  expect(
    await harness.owner`select tick_generation::text from public.notification_scheduler_cursor`,
  ).toEqual([{ tick_generation: '0' }]);
  expect(await harness.owner`select organization_id from public.notification_org_control`).toEqual(
    [],
  );

  const discovered = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(discovered.leases).toHaveLength(1);
  const lease = discovered.leases[0];
  expect(await abandonUnstartedOrganizationLease(runtime, lease)).toBe(true);
  expect(await abandonUnstartedOrganizationLease(runtime, lease)).toBe(false);
  expect(await completeOrganizationLease(runtime, lease, { result: 'completed' })).toBe(false);
  expect(
    await harness.owner`select state,generation::text,owner_id,claimed_at,lease_expires_at,
      hard_deadline,renewal_count,last_result,last_completed_at,last_success_at
      from public.notification_org_control where organization_id=${organizationId}::uuid`,
  ).toEqual([
    {
      state: 'idle',
      generation: '1',
      owner_id: null,
      claimed_at: null,
      lease_expires_at: null,
      hard_deadline: null,
      renewal_count: null,
      last_result: null,
      last_completed_at: null,
      last_success_at: null,
    },
  ]);
  expect(
    await harness.owner`select state,generation::text,claim_count::text,completed_at
      from public.notification_outbox where organization_id=${organizationId}::uuid`,
  ).toEqual([{ state: 'pending', generation: '0', claim_count: '0', completed_at: null }]);
}

export async function verifyInFlightDiscoveryAbort(harness: NotificationSchedulerHarness) {
  const organizationId = fixtureUuid(602, 8);
  await addPending(harness, organizationId, 602);
  const runtime = await acquireSchedulerRuntime();
  const tableLocked = deferred();
  const releaseTable = deferred();
  const holder = harness.competitor.begin(async (tx) => {
    await tx.unsafe('lock table public.notification_outbox in access exclusive mode');
    tableLocked.resolve();
    await releaseTable.promise;
  });
  await tableLocked.promise;

  const controller = new AbortController();
  const discovery = discoverNotificationOrganizations(
    runtime,
    SCHEDULER_SUPPORT,
    4,
    controller.signal,
  ).then(
    () => null,
    (error: unknown) => error,
  );
  try {
    await waitForBlockedOutboxSeek(harness);
    controller.abort(new Error('qualification cancellation after SQL admission'));
  } finally {
    releaseTable.resolve();
    await holder;
  }

  expect(await discovery).toMatchObject({
    code: 'notification_worker_unavailable',
    reason: 'deadline',
  });
  expect(
    await harness.owner`select tick_generation::text,pending_after_org,processing_after_org
      from public.notification_scheduler_cursor`,
  ).toEqual([{ tick_generation: '0', pending_after_org: null, processing_after_org: null }]);
  expect(await harness.owner`select organization_id from public.notification_org_control`).toEqual(
    [],
  );

  const retry = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(retry.leases.map((lease) => lease.organizationId)).toContain(organizationId);
  for (const lease of retry.leases) {
    expect(await abandonUnstartedOrganizationLease(runtime, lease)).toBe(true);
  }
}

export async function verifyAmbiguousAbandonReconciliation(harness: NotificationSchedulerHarness) {
  const organizationId = fixtureUuid(603, 8);
  await addPending(harness, organizationId, 603);
  const runtime = await acquireSchedulerRuntime();
  const discovered = await discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT);
  expect(discovered.leases).toHaveLength(1);
  const lease = discovered.leases[0]!;

  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_org_control
      set lease_expires_at=clock_timestamp()+interval '6 seconds'
      where organization_id=${organizationId}::uuid`;
  });
  expect(await isOrganizationLeaseLive(runtime, lease)).toBe(true);

  const rowLocked = deferred();
  const releaseRow = deferred();
  const holder = harness.competitor.begin(async (tx) => {
    await tx`select organization_id from public.notification_org_control
      where organization_id=${organizationId}::uuid for update`;
    rowLocked.resolve();
    await releaseRow.promise;
  });
  await rowLocked.promise;

  const ambiguous = abandonUnstartedOrganizationLease(runtime, lease).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  try {
    expect(await isOrganizationLeaseLive(runtime, lease)).toBe(true);
    const result = await ambiguous;
    expect(result.value).toBeNull();
    expect(result.error).toBeInstanceOf(NotificationCoordinatorBusy);
    expect(await isOrganizationLeaseLive(runtime, lease)).toBe(true);
    const expiryDeadline = Date.now() + 3_000;
    while (await isOrganizationLeaseLive(runtime, lease)) {
      if (Date.now() >= expiryDeadline) {
        throw new Error('Notification organization lease did not expire during reconciliation');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    releaseRow.resolve();
    await holder;
  }
  expect(await abandonUnstartedOrganizationLease(runtime, lease)).toBe(false);
  expect(await isOrganizationLeaseLive(runtime, lease)).toBe(false);
  expect(await releaseRuntimeLease(runtime)).toBe(true);
}
