import { expect } from 'vitest';
import {
  NotificationProjectionUnavailable,
  type ProjectionObservation,
} from '$server/services/notifications/projection/contracts';
import { reconcileNotificationProjection } from '$server/services/notifications/projection/reconcile';
import { revalidateNotificationCandidate } from '$server/services/notifications/projection/revalidate';
import { projectNotificationAudience } from '$server/services/notifications/projection/transaction';
import { resetNotificationAudienceOperationalState } from './postgres-harness';
import type { NotificationAudienceHarness } from './postgres-harness';
import { acquireScope, type ActiveProjection } from './runtime-cases';

type CandidateScope = Readonly<{
  organizationId: string;
  candidateId: string;
  recipientProfileId: string;
  authoritySha256: string;
}>;

async function projectedManager(
  harness: NotificationAudienceHarness,
  seed: number,
): Promise<{ active: ActiveProjection; scope: CandidateScope }> {
  const active = await acquireScope(harness, seed, 'join.approved');
  expect(await projectNotificationAudience(active, new AbortController().signal)).toMatchObject({
    outcome: 'projected',
  });
  const [candidate] = await harness.owner<
    { candidateId: string; recipientProfileId: string; authoritySha256: string }[]
  >`select id as "candidateId",recipient_profile_id::text as "recipientProfileId",
      authority_sha256 as "authoritySha256"
    from public.notification_audience_candidates
    where organization_id=${active.fixture.organizationId}::uuid
      and event_id=${active.event.id}::uuid and audience_mode='users_manage'`;
  if (!candidate) throw new Error('Projected manager candidate is missing');
  return {
    active,
    scope: Object.freeze({ organizationId: active.fixture.organizationId, ...candidate }),
  };
}

async function candidateState(
  harness: NotificationAudienceHarness,
  candidateId: string,
): Promise<unknown> {
  return harness.owner`select state,cancellation_reason,template_key,parameters_canonical,navigation_id
    from public.notification_audience_candidates where id=${candidateId}::uuid`;
}

export async function verifyRevalidationAuthorityDrift(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const { active, scope } = await projectedManager(harness, 111);
  const descriptor = await revalidateNotificationCandidate(scope);
  expect(descriptor).toMatchObject({
    candidateId: scope.candidateId,
    recipientProfileId: scope.recipientProfileId,
    navigationId: 'join.review',
  });

  await harness.owner`insert into public.permission_rules(org_id,role_key,module,can_manage)
    values(${active.fixture.organizationId}::uuid,'owner','users',true)`;
  expect(await revalidateNotificationCandidate(scope)).toBeNull();
  expect(await candidateState(harness, scope.candidateId)).toEqual([
    {
      state: 'cancelled',
      cancellation_reason: 'authority_changed',
      template_key: null,
      parameters_canonical: null,
      navigation_id: null,
    },
  ]);

  await harness.owner`delete from public.permission_rules
    where org_id=${active.fixture.organizationId}::uuid and role_key='owner' and module='users'`;
  expect(await revalidateNotificationCandidate(scope)).toBeNull();
  expect(await candidateState(harness, scope.candidateId)).toEqual([
    {
      state: 'cancelled',
      cancellation_reason: 'authority_changed',
      template_key: null,
      parameters_canonical: null,
      navigation_id: null,
    },
  ]);
  expect(await reconcileNotificationProjection(active)).toBe(
    'committed' satisfies ProjectionObservation,
  );
}

export async function verifyRevalidationSourceCancellation(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const inactive = await projectedManager(harness, 112);
  await harness.owner`update public.organizations set status='inactive'
    where id=${inactive.active.fixture.organizationId}::uuid`;
  expect(await revalidateNotificationCandidate(inactive.scope)).toBeNull();
  expect(await candidateState(harness, inactive.scope.candidateId)).toMatchObject([
    { state: 'cancelled', cancellation_reason: 'organization_inactive' },
  ]);

  await resetNotificationAudienceOperationalState(harness);
  const changed = await projectedManager(harness, 113);
  await harness.owner`update public.join_request set status='pending',reviewed_at=null
    where id=${changed.active.fixture.requestId}::uuid`;
  expect(await revalidateNotificationCandidate(changed.scope)).toBeNull();
  expect(await candidateState(harness, changed.scope.candidateId)).toMatchObject([
    { state: 'cancelled', cancellation_reason: 'subject_changed' },
  ]);

  await resetNotificationAudienceOperationalState(harness);
  const deleted = await projectedManager(harness, 114);
  await harness.owner`delete from public.join_request where id=${deleted.active.fixture.requestId}::uuid`;
  expect(await revalidateNotificationCandidate(deleted.scope)).toBeNull();
  expect(await candidateState(harness, deleted.scope.candidateId)).toMatchObject([
    { state: 'cancelled', cancellation_reason: 'subject_changed' },
  ]);
}

export async function verifyRevalidationLockTimeout(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const { scope } = await projectedManager(harness, 115);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const blocker = harness.competitor.begin(async (tx) => {
    await tx`select id from public.notification_audience_candidates
      where id=${scope.candidateId}::uuid for update`;
    locked();
    await held;
  });
  await acquired;
  try {
    await expect(revalidateNotificationCandidate(scope)).rejects.toMatchObject({
      name: NotificationProjectionUnavailable.name,
      code: 'notification_projection_unavailable',
      reason: 'revalidation_unavailable',
    });
  } finally {
    release();
    await blocker;
  }
  expect(await candidateState(harness, scope.candidateId)).toMatchObject([
    { state: 'ready', cancellation_reason: null },
  ]);
}
