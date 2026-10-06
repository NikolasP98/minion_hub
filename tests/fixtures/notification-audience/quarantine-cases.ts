import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { expect } from 'vitest';
import { NOTIFICATION_PROJECTION_SUPPORT } from '$lib/notifications/projection-manifest';
import { claimNotificationProjectionEventsInTransaction } from '$server/services/notifications/outbox-claim';
import {
  quarantineNotificationEventsInTransaction,
  renewNotificationEvent,
  settleNotificationEvent,
} from '$server/services/notifications/outbox-settlement';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerTx,
} from '$server/services/notifications/worker-transaction';
import { productionNotificationProjector } from '$server/services/notifications/projection/projector';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
import { acquireRuntimeLease } from '$server/services/notifications/scheduler/runtime-lease';
import { seedJoinAudience } from './data-fixture';
import { audienceRuntimeIdentity, type NotificationAudienceHarness } from './postgres-harness';
import { acquireScope, type ActiveProjection } from './runtime-cases';

type QuarantineLease = ActiveProjection['event']['lease'];

const FOREIGN_ORGANIZATION_ID = '7f000000-0000-4000-8000-000000000011';
const FOREIGN_OWNER_ID = '7f000000-0000-4000-8000-000000000012';

async function clonePendingEvents(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  count: number,
  offset = 1,
): Promise<void> {
  if (count < 1) return;
  await harness.owner.begin(async (tx) => {
    // Exercise the real event-to-outbox trigger with the tenant scope required by its RLS policy.
    await tx`select set_config('app.current_org_id',${active.fixture.organizationId},true)`;
    await tx`
      insert into public.notification_events(
        id,organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
        subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
        semantic_sha256)
      select gen_random_uuid(),e.organization_id,e.kind,e.schema_version,e.catalog_revision,
        e.producer_id,e.subject_type,e.subject_id,e.subject_revision,
        e.source_identity||'.quarantine.'||(series+${offset - 1})::text,
        e.occurred_at+(series::text||' milliseconds')::interval,
        e.dedupe_key||'.quarantine.'||(series+${offset - 1})::text,e.payload_canonical,e.payload_sha256,e.semantic_sha256
      from public.notification_events e cross join generate_series(1,${count}) series
      where e.id=${active.event.id}::uuid`;
  });
}

async function claimBatch(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  total: number,
): Promise<readonly QuarantineLease[]> {
  if (total < 1 || total > 250) throw new Error('Invalid quarantine fixture size');
  await clonePendingEvents(harness, active, total - 1);
  const scope = {
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  } as const;
  const additional =
    total === 1
      ? []
      : await withNotificationWorkerTransaction(scope, async (tx) => {
          const claimed = await claimNotificationProjectionEventsInTransaction(
            tx,
            scope,
            NOTIFICATION_PROJECTION_SUPPORT,
            total - 1,
          );
          expect(claimed.busy).toBe(false);
          expect(claimed.events).toHaveLength(total - 1);
          return claimed.events.map((event) => event.lease);
        });
  return Object.freeze([active.event.lease, ...additional]);
}

function claims(
  leases: readonly QuarantineLease[],
  reason: 'payload_invalid' | 'digest_mismatch' | 'envelope_invalid' = 'payload_invalid',
) {
  return leases.map((lease) => ({ lease, reason }));
}

async function exactScopeSettings(tx: NotificationWorkerTx) {
  const [settings] = await tx<
    { mode: string; event: string; generation: string; reason: string }[]
  >`select current_setting('app.notification_scope_mode',true) as mode,
      current_setting('app.notification_event_id',true) as event,
      current_setting('app.notification_generation',true) as generation,
      current_setting('app.notification_quarantine_reason',true) as reason`;
  return settings;
}

export async function verifyQuarantineBatchAndInputBounds(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 8, 'join.requested');
  const leases = await claimBatch(harness, active, 250);
  const scope = {
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  } as const;
  expect(
    await withNotificationWorkerTransaction(scope, (tx) =>
      quarantineNotificationEventsInTransaction(tx, scope, claims(leases)),
    ),
  ).toBe(250);
  expect(
    await harness.owner<
      { count: number; attributed: number; live: number }[]
    >`select count(*)::int as count,
      count(*) filter(where terminal_owner_id=${scope.ownerId}::uuid
        and terminal_generation=generation and quarantine_reason='payload_invalid')::int as attributed,
      count(*) filter(where lease_owner is not null or lease_expires_at is not null)::int as live
      from public.notification_outbox where organization_id=${scope.organizationId}::uuid`,
  ).toEqual([{ count: 250, attributed: 250, live: 0 }]);
  expect(
    await withNotificationWorkerTransaction(scope, (tx) =>
      quarantineNotificationEventsInTransaction(tx, scope, claims(leases)),
    ),
  ).toBe(0);

  await clonePendingEvents(harness, active, 2, 500);
  const mixedScope = {
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  } as const;
  const mixedLeases = await withNotificationWorkerTransaction(mixedScope, async (tx) => {
    const claimed = await claimNotificationProjectionEventsInTransaction(
      tx,
      mixedScope,
      NOTIFICATION_PROJECTION_SUPPORT,
      2,
    );
    expect(claimed.events).toHaveLength(2);
    return claimed.events.map((event) => event.lease);
  });
  const stale = Object.freeze({ ...mixedLeases[1]!, generation: '2' });
  expect(
    await withNotificationWorkerTransaction(mixedScope, (tx) =>
      quarantineNotificationEventsInTransaction(tx, mixedScope, claims([mixedLeases[0]!, stale])),
    ),
  ).toBe(0);
  expect(
    await harness.owner`select state,completed_at from public.notification_outbox
      where organization_id=${mixedScope.organizationId}::uuid
        and event_id in (${mixedLeases[0]!.eventId}::uuid,${mixedLeases[1]!.eventId}::uuid)
      order by event_id`,
  ).toEqual([
    { state: 'processing', completed_at: null },
    { state: 'processing', completed_at: null },
  ]);

  const invalidInputs: readonly postgres.JSONValue[] = [
    [],
    Array.from({ length: 251 }, (_, index) => ({
      eventId: index === 0 ? mixedLeases[0]!.eventId : randomUUID(),
      generation: '1',
      reason: 'payload_invalid',
    })),
    [{ eventId: mixedLeases[0]!.eventId, generation: '0', reason: 'payload_invalid' }],
    [
      {
        eventId: mixedLeases[0]!.eventId,
        generation: '9223372036854775808',
        reason: 'payload_invalid',
      },
    ],
    [
      {
        eventId: mixedLeases[0]!.eventId.toUpperCase(),
        generation: '1',
        reason: 'payload_invalid',
      },
    ],
    [{ eventId: mixedLeases[0]!.eventId, generation: '1', reason: 'subject_invalid' }],
    [
      { eventId: mixedLeases[0]!.eventId, generation: '1', reason: 'payload_invalid' },
      { eventId: mixedLeases[0]!.eventId, generation: '1', reason: 'payload_invalid' },
    ],
    [{ eventId: mixedLeases[0]!.eventId, generation: '1', reason: 'payload_invalid', extra: true }],
    [
      {
        eventId: mixedLeases[0]!.eventId,
        generation: '1',
        reason: `payload_invalid${'x'.repeat(65_537)}`,
      },
    ],
  ];
  await withNotificationWorkerTransaction(mixedScope, async (tx) => {
    for (const invalid of invalidInputs) {
      await expect(
        tx.savepoint(
          (savepoint) =>
            savepoint`select public.notification_quarantine_claims(${savepoint.json(invalid)}::jsonb)`,
        ),
      ).rejects.toThrow(/Notification quarantine batch is invalid/);
    }
  });
  expect(
    await harness.owner`select state,completed_at from public.notification_outbox
      where organization_id=${mixedScope.organizationId}::uuid
        and event_id in (${mixedLeases[0]!.eventId}::uuid,${mixedLeases[1]!.eventId}::uuid)
      order by event_id`,
  ).toEqual([
    { state: 'processing', completed_at: null },
    { state: 'processing', completed_at: null },
  ]);
}

export async function verifyQuarantineScopeRestoration(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 10, 'join.requested');
  const leases = await claimBatch(harness, active, 2);
  const scope = {
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  } as const;
  await clonePendingEvents(harness, active, 1, 1_000);
  const sentinel = {
    mode: 'outer_scope',
    event: 'outer_event',
    generation: 'outer_generation',
    reason: 'outer_reason',
  } as const;
  await withNotificationWorkerTransaction(scope, async (tx) => {
    expect(await exactScopeSettings(tx)).toEqual({
      mode: '',
      event: '',
      generation: '',
      reason: '',
    });
    await tx`select set_config('app.notification_scope_mode',${sentinel.mode},true),
      set_config('app.notification_event_id',${sentinel.event},true),
      set_config('app.notification_generation',${sentinel.generation},true),
      set_config('app.notification_quarantine_reason',${sentinel.reason},true)`;
    expect(await quarantineNotificationEventsInTransaction(tx, scope, claims([leases[0]!]))).toBe(
      1,
    );
    expect(await exactScopeSettings(tx)).toEqual(sentinel);
    expect(await quarantineNotificationEventsInTransaction(tx, scope, claims([leases[0]!]))).toBe(
      0,
    );
    expect(await exactScopeSettings(tx)).toEqual(sentinel);
    await expect(
      tx.savepoint(
        (savepoint) =>
          savepoint`select public.notification_quarantine_claims(
            ${savepoint.json([{ eventId: leases[1]!.eventId, generation: '0', reason: 'payload_invalid' }])}::jsonb)`,
      ),
    ).rejects.toThrow(/Notification quarantine batch is invalid/);
    expect(await exactScopeSettings(tx)).toEqual(sentinel);

    const next = await claimNotificationProjectionEventsInTransaction(
      tx,
      scope,
      NOTIFICATION_PROJECTION_SUPPORT,
      1,
    );
    expect(next.events).toHaveLength(1);
    expect(next.events[0]?.id).not.toBe(leases[0]!.eventId);
    expect(await exactScopeSettings(tx)).toEqual(sentinel);
  });

  await expect(
    withNotificationWorkerTransaction(scope, async (tx) => {
      await tx`select set_config('app.notification_scope_mode','rolled_back',true),
        set_config('app.notification_quarantine_reason','rolled_back',true)`;
      throw new Error('ROLLBACK_QUARANTINE_SCOPE');
    }),
  ).rejects.toThrow('ROLLBACK_QUARANTINE_SCOPE');
  expect(await withNotificationWorkerTransaction(scope, exactScopeSettings)).toEqual({
    mode: '',
    event: '',
    generation: '',
    reason: '',
  });
  await expect(
    withNotificationWorkerTransaction(scope, async (tx) => {
      await tx`select set_config('statement_timeout','5ms',true)`;
      await tx`select pg_sleep(0.05)`;
    }),
  ).rejects.toMatchObject({ code: 'notification_worker_unavailable', reason: 'statement_timeout' });
  expect(await withNotificationWorkerTransaction(scope, exactScopeSettings)).toEqual({
    mode: '',
    event: '',
    generation: '',
    reason: '',
  });
}

export async function verifyQuarantineAuthorityAndFences(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 11, 'join.requested');
  const scope = {
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  } as const;
  const wrongScopes = [
    { organizationId: FOREIGN_ORGANIZATION_ID, ownerId: scope.ownerId, lease: active.event.lease },
    {
      organizationId: scope.organizationId,
      ownerId: FOREIGN_OWNER_ID,
      lease: { ...active.event.lease, ownerId: FOREIGN_OWNER_ID },
    },
    {
      organizationId: scope.organizationId,
      ownerId: scope.ownerId,
      lease: { ...active.event.lease, eventId: randomUUID() },
    },
    {
      organizationId: scope.organizationId,
      ownerId: scope.ownerId,
      lease: { ...active.event.lease, generation: '2' },
    },
  ] as const;
  for (const wrong of wrongScopes) {
    expect(
      await settleNotificationEvent(
        { organizationId: wrong.organizationId, ownerId: wrong.ownerId },
        wrong.lease,
        'digest_mismatch',
      ),
    ).toBe(false);
  }

  await expect(
    harness.worker.begin(async (tx) => {
      await tx`select set_config('role','notification_worker',true),
        set_config('app.current_org_id',${scope.organizationId},true),
        set_config('app.notification_owner',${scope.ownerId},true),
        set_config('app.notification_generation',${active.event.lease.generation},true)`;
      return tx`update public.notification_outbox set state='quarantined',
        completed_at=clock_timestamp(),quarantine_reason='payload_invalid',lease_owner=null,
        claimed_at=null,hard_deadline=null,lease_expires_at=null,renewal_count=null
        where organization_id=${scope.organizationId}::uuid and event_id=${active.event.id}::uuid`;
    }),
  ).rejects.toThrow();
  expect(
    await harness.owner`select state,completed_at from public.notification_outbox
      where event_id=${active.event.id}::uuid`,
  ).toEqual([{ state: 'processing', completed_at: null }]);

  const privileges = await harness.owner<
    { role: string; execute: boolean; setRole: boolean; usage: boolean }[]
  >`select role_name as role,
      has_function_privilege(role_name,'public.notification_quarantine_claims(jsonb)','EXECUTE') as execute,
      pg_has_role(role_name,'notification_event_trigger','SET') as "setRole",
      pg_has_role(role_name,'notification_event_trigger','USAGE') as usage
    from unnest(array['notification_worker','app_notification_worker','app_ledger',
      'notification_coordinator','notification_health_reader','app_assistant_ro','anon',
      'authenticated','service_role']) role_name order by role_name`;
  expect(privileges.filter((entry) => entry.execute).map((entry) => entry.role)).toEqual([
    'notification_worker',
  ]);
  expect(privileges.every((entry) => !entry.setRole && !entry.usage)).toBe(true);

  await harness.owner.unsafe(`
    alter table public.notification_outbox disable trigger notification_outbox_transition;
    update public.notification_outbox set claimed_at=expired.stamp-interval '61 seconds',
      hard_deadline=expired.stamp-interval '1 second',
      lease_expires_at=expired.stamp-interval '1 second',renewal_count=1
      from (select clock_timestamp() as stamp) expired
      where event_id='${active.event.id}'::uuid;
    alter table public.notification_outbox enable trigger notification_outbox_transition;
  `);
  expect(await settleNotificationEvent(scope, active.event.lease, 'payload_invalid')).toBe(false);
}

export async function verifyQuarantineRenewalRace(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const quarantineFirst = await acquireScope(harness, 12, 'join.requested');
  const firstScope = {
    organizationId: quarantineFirst.fixture.organizationId,
    ownerId: quarantineFirst.event.lease.ownerId,
  } as const;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled!: () => void;
  const quarantineApplied = new Promise<void>((resolve) => {
    settled = resolve;
  });
  const quarantine = harness.worker.begin(async (tx) => {
    await tx`select set_config('role','notification_worker',true),
      set_config('app.current_org_id',${firstScope.organizationId},true),
      set_config('app.current_profile_id','',true),
      set_config('app.notification_owner',${firstScope.ownerId},true),
      set_config('app.notification_scope_mode','',true),
      set_config('app.notification_event_id','',true),
      set_config('app.notification_generation','',true),
      set_config('app.notification_quarantine_reason','',true)`;
    expect(
      await quarantineNotificationEventsInTransaction(
        tx,
        firstScope,
        claims([quarantineFirst.event.lease]),
      ),
    ).toBe(1);
    settled();
    await held;
  });
  await quarantineApplied;
  const renewal = harness.competitor.begin(async (tx) => {
    await tx`select set_config('role','notification_worker',true),
      set_config('app.current_org_id',${firstScope.organizationId},true),
      set_config('app.notification_owner',${firstScope.ownerId},true),
      set_config('app.notification_generation',${quarantineFirst.event.lease.generation},true),
      set_config('lock_timeout','3s',true)`;
    return tx`update public.notification_outbox set renewal_count=1,lease_expires_at=hard_deadline
      where organization_id=${firstScope.organizationId}::uuid
        and event_id=${quarantineFirst.event.id}::uuid and state='processing'
        and lease_owner=${firstScope.ownerId}::uuid
        and generation=${quarantineFirst.event.lease.generation}::bigint
        and renewal_count=0 and lease_expires_at>clock_timestamp()`;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await quarantine;
  expect((await renewal).count).toBe(0);

  await clonePendingEvents(harness, quarantineFirst, 1, 2_000);
  const [renewalFirst] = await withNotificationWorkerTransaction(firstScope, async (tx) => {
    const claimed = await claimNotificationProjectionEventsInTransaction(
      tx,
      firstScope,
      NOTIFICATION_PROJECTION_SUPPORT,
      1,
    );
    expect(claimed.events).toHaveLength(1);
    return claimed.events;
  });
  expect(renewalFirst).toBeDefined();
  if (!renewalFirst) throw new Error('Renewal-first fixture was not claimed');
  const secondScope = {
    organizationId: firstScope.organizationId,
    ownerId: renewalFirst.lease.ownerId,
  } as const;
  const renewed = await renewNotificationEvent(secondScope, renewalFirst.lease);
  expect(renewed).not.toBeNull();
  expect(await settleNotificationEvent(secondScope, renewalFirst.lease, 'envelope_invalid')).toBe(
    true,
  );
  expect(
    await harness.owner`select state,renewal_count,terminal_owner_id::text as owner,
      terminal_generation::text as generation from public.notification_outbox
      where event_id=${renewalFirst.id}::uuid`,
  ).toEqual([
    {
      state: 'quarantined',
      renewal_count: null,
      owner: secondScope.ownerId,
      generation: renewalFirst.lease.generation,
    },
  ]);
}

export async function verifyMalformedProjectorQuarantine(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const fixture = await seedJoinAudience(harness, 14, 'join.requested');
  await harness.owner.unsafe(`
    alter table public.notification_events disable trigger notification_event_evidence;
    update public.notification_events set semantic_sha256=repeat('0',64)
      where id='${fixture.event.id}'::uuid;
    alter table public.notification_events enable trigger notification_event_evidence;
    alter table public.notification_scheduler_cursor disable trigger notification_cursor_transition;
    update public.notification_scheduler_cursor set next_state='pending',
      pending_after_org='11000000-0000-4000-8000-000000000013'::uuid where singleton;
    alter table public.notification_scheduler_cursor enable trigger notification_cursor_transition;
  `);
  const admission = await acquireRuntimeLease(audienceRuntimeIdentity());
  expect(admission.state).toBe('acquired');
  if (admission.state !== 'acquired') throw new Error('Audience runtime fixture was not acquired');
  const discovered = await discoverNotificationOrganizations(
    admission.lease,
    NOTIFICATION_PROJECTION_SUPPORT,
    1,
  );
  expect(discovered.state).toBe('claimed');
  if (discovered.state !== 'claimed') throw new Error('Audience organization was not claimed');
  expect(
    await productionNotificationProjector().projectPage(
      admission.lease,
      discovered.leases[0]!,
      new AbortController().signal,
    ),
  ).toEqual({ result: 'completed' });
  expect(
    await harness.owner`select state,quarantine_reason,terminal_owner_id::text as owner,
      terminal_generation::text as generation from public.notification_outbox
      where event_id=${fixture.event.id}::uuid`,
  ).toEqual([
    {
      state: 'quarantined',
      quarantine_reason: 'digest_mismatch',
      owner: admission.lease.ownerId,
      generation: '1',
    },
  ]);
  expect(
    await withNotificationWorkerTransaction(
      { organizationId: fixture.organizationId, ownerId: admission.lease.ownerId },
      exactScopeSettings,
    ),
  ).toEqual({ mode: '', event: '', generation: '', reason: '' });
}
