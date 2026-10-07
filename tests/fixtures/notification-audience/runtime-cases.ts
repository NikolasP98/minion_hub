import { expect } from 'vitest';
import { NOTIFICATION_PROJECTION_SUPPORT } from '$lib/notifications/projection-manifest';
import {
  claimNotificationProjectionEventsInTransaction,
  type ClaimedNotificationEvent,
} from '$server/services/notifications/outbox-claim';
import {
  renewNotificationEvent,
  settleNotificationEvent,
} from '$server/services/notifications/outbox-settlement';
import { withNotificationWorkerTransaction } from '$server/services/notifications/worker-transaction';
import { reconcileNotificationProjection } from '$server/services/notifications/projection/reconcile';
import { revalidateNotificationCandidate } from '$server/services/notifications/projection/revalidate';
import { projectNotificationAudience } from '$server/services/notifications/projection/transaction';
import { productionNotificationProjector } from '$server/services/notifications/projection/projector';
import { readNotificationProjectionCatalog } from '$server/services/notifications/projection/catalog-admission';
import { notificationProjectionCatalogMatches } from '$server/services/notifications/projection/catalog-fingerprint';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
import { acquireRuntimeLease } from '$server/services/notifications/scheduler/runtime-lease';
import type {
  OrganizationLease,
  RuntimeLease,
} from '$server/services/notifications/scheduler/contracts';
import { seedJoinAudience, type AudienceFixture, type JoinEventKind } from './data-fixture';
import { audienceRuntimeIdentity, type NotificationAudienceHarness } from './postgres-harness';

export type ActiveProjection = Readonly<{
  fixture: AudienceFixture;
  runtime: RuntimeLease;
  organization: OrganizationLease;
  event: ClaimedNotificationEvent;
}>;

const FOREIGN_ORGANIZATION_ID = '7f000000-0000-4000-8000-000000000001';
const FOREIGN_OWNER_ID = '7f000000-0000-4000-8000-000000000002';

function withOperationOwner(active: ActiveProjection, ownerId: string): ActiveProjection {
  return Object.freeze({
    ...active,
    runtime: Object.freeze({ ...active.runtime, ownerId }),
    organization: Object.freeze({ ...active.organization, ownerId }),
    event: Object.freeze({
      ...active.event,
      lease: Object.freeze({ ...active.event.lease, ownerId }),
    }),
  });
}

function withOperationGeneration(active: ActiveProjection, generation: string): ActiveProjection {
  return Object.freeze({
    ...active,
    event: Object.freeze({
      ...active.event,
      lease: Object.freeze({ ...active.event.lease, generation }),
    }),
  });
}

function withOperationOrganization(
  active: ActiveProjection,
  organizationId: string,
): ActiveProjection {
  return Object.freeze({
    ...active,
    organization: Object.freeze({ ...active.organization, organizationId }),
    event: Object.freeze({
      ...active.event,
      organization_id: organizationId,
    }),
  });
}

async function directTerminalVisibility(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  role: 'app_notification_worker' | 'notification_projection_finalizer' | 'notification_worker',
  scopeMode: 'projection' | 'projection_reconcile' = 'projection_reconcile',
) {
  return harness.owner.begin(async (tx) => {
    await tx`select set_config('app.current_org_id',${active.event.organization_id},true),
      set_config('app.notification_scope_mode',${scopeMode},true),
      set_config('app.notification_owner',${active.event.lease.ownerId},true),
      set_config('app.notification_generation',${active.event.lease.generation},true),
      set_config('app.notification_event_id',${active.event.id},true),
      set_config('app.notification_event_catalog_revision',${active.event.catalog_revision},true),
      set_config('app.notification_event_kind',${active.event.kind},true),
      set_config('app.notification_event_schema_version',${active.event.schema_version.toString()},true),
      set_config('app.notification_projection_kind','inbox.v1',true)`;
    await tx.unsafe(`set local role ${role}`);
    const [visible] = await tx<{ outbox: number; receipts: number; candidates: number }[]>`select
      (select count(state)::int from public.notification_outbox
        where organization_id=${active.event.organization_id}::uuid
          and event_id=${active.event.id}::uuid) as outbox,
      (select count(event_id)::int from public.notification_projection_receipts
        where organization_id=${active.event.organization_id}::uuid
          and event_id=${active.event.id}::uuid) as receipts,
      (select count(candidate_sha256)::int from public.notification_audience_candidates
        where organization_id=${active.event.organization_id}::uuid
          and event_id=${active.event.id}::uuid) as candidates`;
    return visible;
  });
}

async function directOutboxVisibility(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  role: 'app_notification_worker' | 'notification_worker',
): Promise<number> {
  return harness.owner.begin(async (tx) => {
    await tx`select set_config('app.current_org_id',${active.event.organization_id},true),
      set_config('app.notification_scope_mode','projection_reconcile',true),
      set_config('app.notification_owner',${active.event.lease.ownerId},true),
      set_config('app.notification_generation',${active.event.lease.generation},true),
      set_config('app.notification_event_id',${active.event.id},true)`;
    await tx.unsafe(`set local role ${role}`);
    const [visible] = await tx<
      { count: number }[]
    >`select count(state)::int as count from public.notification_outbox
      where organization_id=${active.event.organization_id}::uuid
        and event_id=${active.event.id}::uuid`;
    return visible?.count ?? -1;
  });
}

export async function acquireScope(
  harness: NotificationAudienceHarness,
  seed: number,
  kind: JoinEventKind,
): Promise<ActiveProjection> {
  const fixture = await seedJoinAudience(harness, seed, kind);
  const admission = await acquireRuntimeLease(audienceRuntimeIdentity());
  expect(admission.state).toBe('acquired');
  if (admission.state !== 'acquired') throw new Error('Audience runtime fixture was not acquired');
  const discovered = await discoverNotificationOrganizations(
    admission.lease,
    NOTIFICATION_PROJECTION_SUPPORT,
    1,
  );
  expect(discovered.state).toBe('claimed');
  expect(discovered.leases).toHaveLength(1);
  const organization = discovered.leases[0]!;
  expect(organization.organizationId).toBe(fixture.organizationId);
  const claimed = await withNotificationWorkerTransaction(
    { organizationId: fixture.organizationId, ownerId: admission.lease.ownerId },
    (tx) =>
      claimNotificationProjectionEventsInTransaction(
        tx,
        { organizationId: fixture.organizationId, ownerId: admission.lease.ownerId },
        NOTIFICATION_PROJECTION_SUPPORT,
        1,
      ),
  );
  expect(claimed.events).toHaveLength(1);
  const renewed = await renewNotificationEvent(
    { organizationId: fixture.organizationId, ownerId: admission.lease.ownerId },
    claimed.events[0]!.lease,
  );
  expect(renewed).not.toBeNull();
  return Object.freeze({
    fixture,
    runtime: admission.lease,
    organization,
    event: Object.freeze({ ...claimed.events[0]!, lease: renewed! }),
  });
}

export async function verifyProjectionCatalogAdmission(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const snapshot = await harness.owner.begin((tx) => readNotificationProjectionCatalog(tx));
  expect(notificationProjectionCatalogMatches(snapshot)).toBe(true);
}

export async function verifyProductionRequestedProjection(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const fixture = await seedJoinAudience(harness, 1, 'join.requested');
  const admission = await acquireRuntimeLease(audienceRuntimeIdentity());
  expect(admission.state).toBe('acquired');
  if (admission.state !== 'acquired') throw new Error('Audience runtime fixture was not acquired');
  const discovered = await discoverNotificationOrganizations(
    admission.lease,
    NOTIFICATION_PROJECTION_SUPPORT,
    1,
  );
  expect(discovered.state).toBe('claimed');
  const lease = discovered.leases[0]!;
  expect(lease.organizationId).toBe(fixture.organizationId);
  const result = await productionNotificationProjector().projectPage(
    admission.lease,
    lease,
    new AbortController().signal,
  );
  expect(result).toEqual({ result: 'completed' });

  const rows = await harness.owner<
    {
      recipient: string;
      mode: string;
      parameters: string | null;
      navigation: string | null;
      state: string;
    }[]
  >`select recipient_profile_id::text as recipient,audience_mode as mode,
      parameters_canonical as parameters,navigation_id as navigation,state
    from public.notification_audience_candidates where organization_id=${fixture.organizationId}::uuid`;
  expect(rows).toEqual([
    {
      recipient: fixture.managerId,
      mode: 'users_manage',
      parameters: '{}',
      navigation: 'join.review',
      state: 'ready',
    },
  ]);
  const [terminal] = await harness.owner<
    {
      state: string;
      terminalOwner: string;
      terminalGeneration: string;
      count: number;
      finalized: boolean;
    }[]
  >`select o.state,o.terminal_owner_id::text as "terminalOwner",
      o.terminal_generation::text as "terminalGeneration",r.candidate_count as count,
      r.finalized_at is not null as finalized
    from public.notification_outbox o join public.notification_projection_receipts r
      on r.organization_id=o.organization_id and r.event_id=o.event_id
    where o.event_id=${fixture.event.id}::uuid`;
  expect(terminal).toEqual({
    state: 'projected',
    terminalOwner: admission.lease.ownerId,
    terminalGeneration: '1',
    count: 1,
    finalized: true,
  });
  const serialized = JSON.stringify(
    await harness.owner`
    select * from public.notification_audience_candidates
    where organization_id=${fixture.organizationId}::uuid`,
  );
  expect(serialized).not.toContain('Private applicant');
  expect(serialized).not.toContain('private-message');
  expect(serialized).not.toContain('@example.invalid');
}

export async function verifyApplicantProjectionAndTerminalObservation(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 2, 'join.approved');
  const result = await projectNotificationAudience(active, new AbortController().signal);
  expect(result.outcome).toBe('projected');
  expect(result.receipt?.candidateCount).toBe(2);
  expect(await reconcileNotificationProjection(active)).toBe('committed');
  const candidates = await harness.owner<
    { id: string; recipient: string; mode: string; authority: string }[]
  >`select id,recipient_profile_id::text as recipient,audience_mode as mode,
      authority_sha256 as authority from public.notification_audience_candidates
    where organization_id=${active.fixture.organizationId}::uuid order by recipient_profile_id`;
  expect(candidates.map(({ recipient, mode }) => ({ recipient, mode }))).toEqual([
    { recipient: active.fixture.applicantId, mode: 'join_applicant' },
    { recipient: active.fixture.managerId, mode: 'users_manage' },
  ]);

  await harness.owner`delete from auth.users where id=${active.fixture.applicantId}::uuid`;
  expect(
    await harness.owner`select recipient_profile_id::text as recipient
      from public.notification_audience_candidates
      where organization_id=${active.fixture.organizationId}::uuid order by recipient_profile_id`,
  ).toEqual([{ recipient: active.fixture.managerId }]);
  expect(await reconcileNotificationProjection(active)).toBe('committed');

  const manager = candidates.find((candidate) => candidate.recipient === active.fixture.managerId)!;
  await harness.owner`delete from public.organization_members
    where organization_id=${active.fixture.organizationId}::uuid
      and profile_id=${active.fixture.managerId}::uuid`;
  expect(
    await revalidateNotificationCandidate({
      organizationId: active.fixture.organizationId,
      candidateId: manager.id,
      recipientProfileId: manager.recipient,
      authoritySha256: manager.authority,
    }),
  ).toBeNull();
  expect(
    await harness.owner`select state,cancellation_reason,template_key,parameters_canonical,navigation_id
      from public.notification_audience_candidates where id=${manager.id}::uuid`,
  ).toEqual([
    {
      state: 'cancelled',
      cancellation_reason: 'membership_revoked',
      template_key: null,
      parameters_canonical: null,
      navigation_id: null,
    },
  ]);
  expect(await reconcileNotificationProjection(active)).toBe('committed');
}

export async function verifyInvalidSubjectQuarantine(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 3, 'join.denied');
  await harness.owner`update public.join_request set user_id=${active.fixture.managerId}
    where id=${active.fixture.requestId}::uuid`;
  const result = await projectNotificationAudience(active, new AbortController().signal);
  expect(result).toEqual({ outcome: 'subject_invalid', receipt: null });
  expect(
    await harness.owner`select state,quarantine_reason,terminal_owner_id::text as owner,
      terminal_generation::text as generation from public.notification_outbox
      where event_id=${active.event.id}::uuid`,
  ).toEqual([
    {
      state: 'quarantined',
      quarantine_reason: 'subject_invalid',
      owner: active.event.lease.ownerId,
      generation: active.event.lease.generation,
    },
  ]);
  expect(
    await harness.owner`select count(*)::int as count from public.notification_projection_receipts
      where event_id=${active.event.id}::uuid`,
  ).toEqual([{ count: 0 }]);
  expect(
    await harness.owner`select count(*)::int as count from public.notification_audience_candidates
      where event_id=${active.event.id}::uuid`,
  ).toEqual([{ count: 0 }]);
  expect(await reconcileNotificationProjection(active)).toBe('quarantined');
}

export async function verifyDirectRoleAndCommitGuardDenials(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 4, 'join.requested');
  await expect(
    harness.worker.begin(async (tx) => {
      await tx`select set_config('role','notification_worker',true),
        set_config('app.current_org_id',${active.fixture.organizationId},true)`;
      return tx`insert into public.notification_projection_receipts(
        organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,
        adapter_revision,claim_owner_id,claim_generation,candidate_count,body_byte_total,
        candidate_set_sha256)
      values(${active.fixture.organizationId}::uuid,${active.event.id}::uuid,
        ${active.event.catalog_revision},${active.event.kind},${active.event.schema_version},
        'inbox.v1','join-requested.v1',${active.event.lease.ownerId}::uuid,
        ${active.event.lease.generation}::bigint,0,0,${'0'.repeat(64)})`;
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    await harness.worker.begin(async (tx) => {
      await tx`select set_config('role','app_notification_worker',true),
        set_config('app.current_org_id',${active.fixture.organizationId},true),
        set_config('app.notification_scope_mode','projection_reconcile',true)`;
      return tx`select public.notification_finalize_audience('projected') as finalized`;
    }),
  ).toEqual([{ finalized: false }]);

  await expect(
    harness.owner.begin(async (tx) => {
      await tx`insert into public.notification_projection_receipts(
        organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,
        adapter_revision,claim_owner_id,claim_generation,candidate_count,body_byte_total,
        candidate_set_sha256)
      values(${active.fixture.organizationId}::uuid,${active.event.id}::uuid,
        ${active.event.catalog_revision},${active.event.kind},${active.event.schema_version},
        'inbox.v1','join-requested.v1',${active.event.lease.ownerId}::uuid,
        ${active.event.lease.generation}::bigint,0,0,${'0'.repeat(64)})`;
    }),
  ).rejects.toThrow();
  expect(
    await harness.owner`select count(*)::int as count from public.notification_projection_receipts
      where event_id=${active.event.id}::uuid`,
  ).toEqual([{ count: 0 }]);

  await expect(
    settleNotificationEvent(
      {
        organizationId: active.fixture.organizationId,
        ownerId: active.event.lease.ownerId,
      },
      active.event.lease,
      'projected',
    ),
  ).rejects.toThrow();

  expect(await projectNotificationAudience(active, new AbortController().signal)).toMatchObject({
    outcome: 'projected',
  });
  expect(await directTerminalVisibility(harness, active, 'app_notification_worker')).toEqual({
    outbox: 0,
    receipts: 0,
    candidates: 0,
  });
  expect(await directOutboxVisibility(harness, active, 'notification_worker')).toBe(0);
  await expect(
    directTerminalVisibility(harness, active, 'notification_worker'),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    await directTerminalVisibility(
      harness,
      active,
      'notification_projection_finalizer',
      'projection',
    ),
  ).toEqual({
    outbox: 1,
    receipts: 1,
    candidates: 0,
  });
  expect(
    await directTerminalVisibility(
      harness,
      withOperationOwner(active, FOREIGN_OWNER_ID),
      'notification_projection_finalizer',
      'projection',
    ),
  ).toEqual({ outbox: 0, receipts: 0, candidates: 0 });
  expect(
    await directTerminalVisibility(
      harness,
      withOperationGeneration(active, '2'),
      'notification_projection_finalizer',
      'projection',
    ),
  ).toEqual({ outbox: 0, receipts: 0, candidates: 0 });
  expect(
    await directTerminalVisibility(
      harness,
      withOperationOrganization(active, FOREIGN_ORGANIZATION_ID),
      'notification_projection_finalizer',
      'projection',
    ),
  ).toEqual({ outbox: 0, receipts: 0, candidates: 0 });

  expect(await reconcileNotificationProjection(withOperationOwner(active, FOREIGN_OWNER_ID))).toBe(
    'superseded',
  );
  expect(await reconcileNotificationProjection(withOperationGeneration(active, '2'))).toBe(
    'superseded',
  );
  expect(
    await reconcileNotificationProjection(
      withOperationOrganization(active, FOREIGN_ORGANIZATION_ID),
    ),
  ).toBe('absent');
}

async function candidateGuardDefinition(harness: NotificationAudienceHarness): Promise<string> {
  const [guard] = await harness.owner<
    { definition: string }[]
  >`select pg_get_functiondef('public.notification_candidate_guard()'::regprocedure) as definition`;
  if (!guard?.definition) throw new Error('Notification candidate guard source is unavailable');
  return guard.definition;
}

async function suppressCandidateCommand(
  harness: NotificationAudienceHarness,
  operation: 'INSERT' | 'UPDATE',
): Promise<void> {
  await harness.owner.unsafe(`
    create or replace function public.notification_candidate_guard() returns trigger
    language plpgsql set search_path='' as $$
    begin
      if tg_op='${operation}' then return null; end if;
      return new;
    end $$
  `);
}

export async function verifyCommandTagAdmissions(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 5, 'join.requested');
  const originalGuard = await candidateGuardDefinition(harness);
  try {
    await suppressCandidateCommand(harness, 'INSERT');
    await expect(
      projectNotificationAudience(active, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'notification_projection_unavailable',
      reason: 'integrity_failed',
    });
  } finally {
    await harness.owner.unsafe(originalGuard);
  }
  expect(await candidateGuardDefinition(harness)).toBe(originalGuard);
  expect(
    await harness.owner`select
      (select count(*)::int from public.notification_projection_receipts
        where event_id=${active.event.id}::uuid) as receipts,
      (select count(*)::int from public.notification_audience_candidates
        where event_id=${active.event.id}::uuid) as candidates`,
  ).toEqual([{ receipts: 0, candidates: 0 }]);

  expect(await projectNotificationAudience(active, new AbortController().signal)).toMatchObject({
    outcome: 'projected',
  });
  const [candidate] = await harness.owner<
    { id: string; recipient: string; authority: string }[]
  >`select id,recipient_profile_id::text as recipient,authority_sha256 as authority
    from public.notification_audience_candidates where event_id=${active.event.id}::uuid`;
  if (!candidate) throw new Error('Notification candidate was not projected');
  await harness.owner`delete from public.organization_members
    where organization_id=${active.fixture.organizationId}::uuid
      and profile_id=${candidate.recipient}::uuid`;
  try {
    await suppressCandidateCommand(harness, 'UPDATE');
    await expect(
      revalidateNotificationCandidate({
        organizationId: active.fixture.organizationId,
        candidateId: candidate.id,
        recipientProfileId: candidate.recipient,
        authoritySha256: candidate.authority,
      }),
    ).rejects.toMatchObject({
      code: 'notification_projection_unavailable',
      reason: 'revalidation_unavailable',
    });
  } finally {
    await harness.owner.unsafe(originalGuard);
  }
  expect(await candidateGuardDefinition(harness)).toBe(originalGuard);
  expect(
    await harness.owner`select state,cancellation_reason from public.notification_audience_candidates
      where id=${candidate.id}::uuid`,
  ).toEqual([{ state: 'ready', cancellation_reason: null }]);
}

export async function verifyStaleProjectionFence(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 6, 'join.requested');
  await harness.owner.unsafe(`
    alter table public.notification_outbox disable trigger notification_outbox_transition;
    update public.notification_outbox set generation=generation+1,claim_count=claim_count+1
      where event_id='${active.event.id}'::uuid;
    alter table public.notification_outbox enable trigger notification_outbox_transition;
  `);
  await expect(
    projectNotificationAudience(active, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'notification_projection_unavailable',
    reason: 'scope_lost',
  });
  expect(
    await harness.owner`select
      (select count(*)::int from public.notification_projection_receipts
        where event_id=${active.event.id}::uuid) as receipts,
      (select count(*)::int from public.notification_audience_candidates
        where event_id=${active.event.id}::uuid) as candidates`,
  ).toEqual([{ receipts: 0, candidates: 0 }]);
}

export async function verifyClaimQuarantineCommandTag(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 7, 'join.requested');
  const scope = Object.freeze({
    organizationId: active.fixture.organizationId,
    ownerId: active.event.lease.ownerId,
  });
  expect(
    await settleNotificationEvent(
      scope,
      Object.freeze({ ...active.event.lease, generation: '2' }),
      'payload_invalid',
    ),
  ).toBe(false);
  expect(
    await settleNotificationEvent(
      Object.freeze({ ...scope, ownerId: FOREIGN_OWNER_ID }),
      Object.freeze({ ...active.event.lease, ownerId: FOREIGN_OWNER_ID }),
      'payload_invalid',
    ),
  ).toBe(false);
  expect(await settleNotificationEvent(scope, active.event.lease, 'payload_invalid')).toBe(true);
  expect(await settleNotificationEvent(scope, active.event.lease, 'payload_invalid')).toBe(false);
  expect(await directOutboxVisibility(harness, active, 'notification_worker')).toBe(0);
  expect(
    await harness.owner`select state,quarantine_reason,terminal_owner_id::text as owner,
      terminal_generation::text as generation from public.notification_outbox
      where event_id=${active.event.id}::uuid`,
  ).toEqual([
    {
      state: 'quarantined',
      quarantine_reason: 'payload_invalid',
      owner: active.event.lease.ownerId,
      generation: active.event.lease.generation,
    },
  ]);
}
