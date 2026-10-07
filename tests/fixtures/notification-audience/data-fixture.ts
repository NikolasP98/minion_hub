import {
  admitNotificationEvent,
  type AdmittedEvent,
} from '$server/services/notifications/event-envelope';
import type { NotificationAudienceHarness } from './postgres-harness';

const FIXED_AT = '2026-10-03T12:00:00.000Z';

export type JoinEventKind = 'join.requested' | 'join.approved' | 'join.denied';

export type AudienceFixture = Readonly<{
  organizationId: string;
  requestId: string;
  applicantId: string;
  managerId: string;
  foreignManagerId: string;
  event: AdmittedEvent & Readonly<{ id: string }>;
}>;

function uuid(seed: number, group: number): string {
  return `${group}1000000-0000-4000-8000-${seed.toString().padStart(12, '0')}`;
}

function instantFor(kind: JoinEventKind): string {
  return kind === 'join.requested' ? FIXED_AT : '2026-10-03T12:01:00.000Z';
}

export async function seedJoinAudience(
  harness: NotificationAudienceHarness,
  seed: number,
  kind: JoinEventKind = 'join.requested',
): Promise<AudienceFixture> {
  const organizationId = uuid(seed, 1);
  const foreignOrganizationId = uuid(seed, 2);
  const requestId = uuid(seed, 3);
  const applicantId = uuid(seed, 4);
  const managerId = uuid(seed, 5);
  const foreignManagerId = uuid(seed, 6);
  const status =
    kind === 'join.requested' ? 'pending' : kind === 'join.approved' ? 'approved' : 'denied';
  const createdAt = FIXED_AT;
  const reviewedAt = kind === 'join.requested' ? null : instantFor(kind);
  const payload =
    kind === 'join.requested'
      ? { requestId, applicantProfileId: applicantId }
      : { requestId, applicantProfileId: applicantId, decidedAt: reviewedAt! };
  const subjectRevision = `${status}:${kind === 'join.requested' ? createdAt : reviewedAt}`;
  const event = admitNotificationEvent(organizationId, {
    kind,
    subjectRevision,
    sourceIdentity: `join.fixture.${seed}`,
    occurredAt: instantFor(kind),
    dedupeKey: `join.${kind}.${seed}`,
    payload,
  } as Parameters<typeof admitNotificationEvent>[1]);

  await harness.owner`
    insert into public.organizations(id,name,slug,status) values
      (${organizationId}::uuid,${`Audience ${seed}`},${`audience-${seed}`},'active'),
      (${foreignOrganizationId}::uuid,${`Foreign ${seed}`},${`foreign-${seed}`},'active')`;
  await harness.owner`
    insert into auth.users(id,email) values
      (${applicantId}::uuid,${`applicant-${seed}@example.invalid`}),
      (${managerId}::uuid,${`manager-${seed}@example.invalid`}),
      (${foreignManagerId}::uuid,${`foreign-${seed}@example.invalid`})`;
  await harness.owner`
    insert into public.profiles(id,email,display_name,role) values
      (${applicantId}::uuid,${`applicant-${seed}@example.invalid`},'Private applicant','user'),
      (${managerId}::uuid,${`manager-${seed}@example.invalid`},'Current manager','user'),
      (${foreignManagerId}::uuid,${`foreign-${seed}@example.invalid`},'Foreign manager','admin')`;
  await harness.owner`
    insert into public.organization_members(organization_id,profile_id,role) values
      (${organizationId}::uuid,${managerId}::uuid,'owner'),
      (${foreignOrganizationId}::uuid,${foreignManagerId}::uuid,'owner')`;
  await harness.owner`
    insert into public.join_request(id,supabase_id,user_id,email,display_name,message,status,
      organization_id,requested_role,reviewed_at,created_at,updated_at)
    values(${requestId}::uuid,${applicantId}::uuid,${applicantId},
      ${`applicant-${seed}@example.invalid`},'Private applicant',${`private-message-${seed}`},${status},
      ${organizationId},'user',${reviewedAt}::timestamptz,${createdAt}::timestamptz,${instantFor(kind)}::timestamptz)`;
  await harness.worker.begin(async (tx) => {
    await tx`select set_config('role','app_ledger',true),
      set_config('app.current_org_id',${organizationId},true),
      set_config('app.current_profile_id','',true)`;
    await tx`insert into public.notification_events(
      organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
      subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
      semantic_sha256)
    values(${event.organizationId}::uuid,${event.kind},${event.schemaVersion},${event.catalogRevision},
      ${event.producerId},${event.subjectType},${event.subjectId}::uuid,${event.subjectRevision},
      ${event.sourceIdentity},${event.occurredAt}::timestamptz,${event.dedupeKey},
      ${event.payloadCanonical},${event.payloadSha256},${event.semanticSha256})`;
  });
  const [stored] = await harness.owner<{ id: string }[]>`
    select id from public.notification_events where organization_id=${organizationId}::uuid
      and producer_id=${event.producerId} and dedupe_key=${event.dedupeKey}`;
  if (!stored) throw new Error('Audience event fixture was not inserted');
  return Object.freeze({
    organizationId,
    requestId,
    applicantId,
    managerId,
    foreignManagerId,
    event: Object.freeze({ ...event, id: stored.id }),
  });
}
