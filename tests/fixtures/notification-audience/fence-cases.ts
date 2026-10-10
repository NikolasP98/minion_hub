import { expect } from 'vitest';
import { NOTIFICATION_PROJECTION_SUPPORT } from '$lib/notifications/projection-manifest';
import { projectNotificationAudience } from '$server/services/notifications/projection/transaction';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
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
  await removeAbandonedFixtureOperation(harness, active);
}

export async function verifyProjectionJitIsTransactionLocal(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await harness.worker`set jit=on`;
  const active = await acquireScope(harness, 135, 'join.requested');
  await harness.worker`select set_config('request.jwt.claim.sub',${active.fixture.applicantId},false),
    set_config('request.jwt.claims',${JSON.stringify({ sub: active.fixture.applicantId })},false)`;
  harness.workerQueries.length = 0;
  await expect(
    projectNotificationAudience(active, new AbortController().signal),
  ).resolves.toMatchObject({
    outcome: 'projected',
  });
  const clear = harness.workerQueries.findIndex(
    ({ sql }) =>
      sql.includes("set_config('request.jwt.claim.sub','',true)") &&
      sql.includes("set_config('request.jwt.claims','{}',true)"),
  );
  const identity = harness.workerQueries.findIndex(({ sql }) =>
    sql.includes('select auth.uid() is null as identity_cleared'),
  );
  const role = harness.workerQueries.findIndex(({ sql }) =>
    sql.includes("set_config('role','app_notification_worker',true)"),
  );
  const proof = harness.workerQueries.findIndex(
    ({ sql }) =>
      sql.includes("current_user='app_notification_worker'") && sql.includes('as scope_proven'),
  );
  expect([clear, identity, role, proof].every((index) => index >= 0)).toBe(true);
  expect(clear).toBeLessThan(identity);
  expect(identity).toBeLessThan(role);
  expect(role).toBeLessThan(proof);
  // The worker pool has max=1, so this is the same physical connection after COMMIT.
  // Projection's set_config(..., true) must not leak into the next borrower.
  expect(await harness.worker<{ jit: string }[]>`select current_setting('jit') as jit`).toEqual([
    { jit: 'on' },
  ]);
  expect(
    await harness.worker<{ sub: string; claims: string }[]>`
      select current_setting('request.jwt.claim.sub') as sub,
        current_setting('request.jwt.claims') as claims`,
  ).toEqual([
    {
      sub: active.fixture.applicantId,
      claims: JSON.stringify({ sub: active.fixture.applicantId }),
    },
  ]);
  expect(
    await completeOrganizationLease(active.runtime, active.organization, { result: 'completed' }),
  ).toBe(true);
  expect(
    await discoverNotificationOrganizations(active.runtime, NOTIFICATION_PROJECTION_SUPPORT, 1),
  ).toMatchObject({ state: 'idle' });
  expect(await releaseRuntimeLease(active.runtime)).toBe(true);
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
  await removeAbandonedFixtureOperation(harness, organizationLost);
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

export async function verifyLeaseExpiryDuringAuthorityRead(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 136, 'join.requested');
  const [definition] = await harness.owner<{ definition: string }[]>`
    select pg_get_functiondef('public.notification_projection_source_fence(uuid)'::regprocedure)
      as definition`;
  if (!definition) throw new Error('Projection source fence definition is missing');
  const lockKey = 1_360_019;
  await harness.owner.unsafe(`
    create or replace function public.notification_projection_source_fence(expected_org uuid)
    returns boolean language plpgsql volatile set search_path='' as $barrier$
    declare calls integer:=coalesce(nullif(current_setting('app.notif019_fence_calls',true),''),'0')::integer;
    begin
      perform set_config('app.notif019_fence_calls',(calls+1)::text,true);
      if calls>0 then perform pg_advisory_xact_lock(${lockKey}); end if;
      return case current_setting('app.notification_scope_mode',true)
        when 'projection' then expected_org::text=current_setting('app.current_org_id',true)
          and exists(select 1 from public.notification_worker_runtime)
          and exists(select 1 from public.notification_org_control where organization_id=expected_org)
          and exists(select 1 from public.notification_outbox where organization_id=expected_org)
        when 'revalidation' then expected_org::text=current_setting('app.current_org_id',true)
          and exists(select 1 from public.notification_audience_candidates c
            where c.organization_id=expected_org
              and c.id::text=current_setting('app.notification_candidate_id',true)
              and c.recipient_profile_id::text=current_setting('app.notification_recipient_profile_id',true)
              and c.authority_sha256=current_setting('app.notification_authority_sha256',true)
              and c.state='ready')
        else false end;
    end $barrier$`);
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const blocker = harness.competitor.begin(async (tx) => {
    await tx`select pg_advisory_lock(${lockKey})`;
    locked();
    await held;
    await tx`select pg_advisory_unlock(${lockKey})`;
  });
  await ready;
  try {
    const projection = projectNotificationAudience(active, new AbortController().signal);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [waiting] = await harness.owner<{ waiting: boolean }[]>`
        select exists(select 1 from pg_stat_activity
          where application_name='notification-slice5-worker'
            and wait_event_type='Lock' and wait_event='advisory') as waiting`;
      if (waiting?.waiting) break;
      if (attempt === 99) throw new Error('Authority statement did not reach the fence barrier');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await harness.owner.unsafe(`
      alter table public.notification_worker_runtime disable trigger notification_runtime_transition;
      update public.notification_worker_runtime
        set owner_id=null,lease_expires_at=null,stopped_at=clock_timestamp()
        where singleton;
      alter table public.notification_worker_runtime enable trigger notification_runtime_transition`);
    release();
    await expect(projection).rejects.toMatchObject({
      code: 'notification_projection_unavailable',
      reason: 'scope_lost',
    });
    expect(await projectionRows(harness, active)).toEqual([
      { receipts: 0, candidates: 0, state: 'processing' },
    ]);
  } finally {
    release();
    await blocker;
    await harness.owner.unsafe(definition.definition);
  }
}
