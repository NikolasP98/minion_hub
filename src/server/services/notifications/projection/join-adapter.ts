import { createHash } from 'node:crypto';
import { canonicalNotificationPayload, utf8Bytes } from '$lib/notifications/canonical';
import { parseEncodedNotificationPayload } from '$lib/notifications/catalog';
import { UUID_PATTERN } from '$lib/notifications/fields';
import {
  NOTIFICATION_PROJECTION_KIND,
  notificationProjectionTemplate,
  type NotificationNavigationId,
  type NotificationTemplateKey,
} from '$lib/notifications/projection-manifest';
import type { ClaimedNotificationEvent } from '../outbox-claim';
import { authorityDigest, type AuthorizedRecipient } from './authority';
import { PROJECTION_LIMITS, type AudienceMode, type ProjectionCandidate } from './contracts';

export type JoinRequestEvidence = Readonly<{
  id: string;
  organizationId: string;
  supabaseId: string;
  userId: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  profileExists: boolean;
  organizationActive: boolean;
}>;

export type JoinProjectionInput = Readonly<{
  event: JoinProjectionEvent;
  request: JoinRequestEvidence | null;
  managers: readonly AuthorizedRecipient[];
}>;

export type JoinProjectionEvent = Pick<
  ClaimedNotificationEvent,
  | 'id'
  | 'organization_id'
  | 'kind'
  | 'schema_version'
  | 'catalog_revision'
  | 'subject_type'
  | 'subject_id'
  | 'subject_revision'
  | 'payload_canonical'
>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalUuid(value: string): string | null {
  const lower = value.toLowerCase();
  return UUID_PATTERN.test(lower) ? lower : null;
}

function canonicalInstant(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function candidateDigest(values: readonly (string | number)[]): string {
  // PostgreSQL jsonb_build_array(... )::text separates elements with comma+space.
  return sha256(`[${values.map((value) => JSON.stringify(value)).join(', ')}]`);
}

function descriptorFor(
  kind: JoinProjectionEvent['kind'],
  audienceMode: AudienceMode,
): { templateKey: NotificationTemplateKey; navigationId: NotificationNavigationId } {
  if (kind === 'join.requested' && audienceMode === 'users_manage')
    return { templateKey: 'join.requested.manager.v1', navigationId: 'join.review' };
  if (kind === 'join.approved')
    return audienceMode === 'join_applicant'
      ? { templateKey: 'join.approved.applicant.v1', navigationId: 'join.status.approved' }
      : { templateKey: 'join.approved.manager.v1', navigationId: 'join.review' };
  if (kind === 'join.denied')
    return audienceMode === 'join_applicant'
      ? { templateKey: 'join.denied.applicant.v1', navigationId: 'join.status.denied' }
      : { templateKey: 'join.denied.manager.v1', navigationId: 'join.review' };
  throw new Error('Unsupported notification join descriptor');
}

function validJoinSubject(
  input: JoinProjectionInput,
): { applicantId: string; adapterRevision: string } | null {
  const { event, request } = input;
  if (!request || event.subject_type !== 'join_request' || event.subject_id !== request.id)
    return null;
  if (!request.organizationActive || request.organizationId !== event.organization_id) return null;
  const requestUser = canonicalUuid(request.userId);
  const requestSupabase = canonicalUuid(request.supabaseId);
  if (!requestUser || !requestSupabase || requestUser !== requestSupabase || !request.profileExists)
    return null;
  if (!['join.requested', 'join.approved', 'join.denied'].includes(event.kind)) return null;
  const parsed = parseEncodedNotificationPayload(
    event.kind as 'join.requested' | 'join.approved' | 'join.denied',
    event.payload_canonical,
  ).payload as { requestId: string; applicantProfileId: string; decidedAt?: string };
  if (parsed.requestId !== request.id || parsed.applicantProfileId !== requestSupabase) return null;
  const expectedStatus =
    event.kind === 'join.requested'
      ? 'pending'
      : event.kind === 'join.approved'
        ? 'approved'
        : 'denied';
  if (request.status !== expectedStatus) return null;
  const instant = canonicalInstant(
    event.kind === 'join.requested' ? request.createdAt : (request.reviewedAt ?? ''),
  );
  if (!instant) return null;
  if (event.kind !== 'join.requested' && parsed.decidedAt !== instant) return null;
  if (event.subject_revision !== `${expectedStatus}:${instant}`) return null;
  return {
    applicantId: requestSupabase,
    adapterRevision: event.kind === 'join.requested' ? 'join-requested.v1' : 'join-outcome.v1',
  };
}

export function projectJoinAudience(
  input: JoinProjectionInput,
):
  | Readonly<{ state: 'invalid' }>
  | Readonly<{ state: 'overflow' }>
  | Readonly<{ state: 'ready'; candidates: readonly ProjectionCandidate[] }> {
  const subject = validJoinSubject(input);
  if (!subject) return Object.freeze({ state: 'invalid' });
  const recipients = new Map<string, AuthorizedRecipient>();
  for (const manager of input.managers) recipients.set(manager.profileId, manager);
  if (input.event.kind !== 'join.requested') {
    recipients.set(
      subject.applicantId,
      Object.freeze({
        profileId: subject.applicantId,
        audienceMode: 'join_applicant',
        evidence: canonicalNotificationPayload({ applicant: subject.applicantId }),
      }),
    );
  }
  if (recipients.size > PROJECTION_LIMITS.recipients) return Object.freeze({ state: 'overflow' });
  const candidates = [...recipients.values()]
    .sort((left, right) => left.profileId.localeCompare(right.profileId, 'en-US'))
    .map((recipient) => {
      const descriptor = descriptorFor(input.event.kind, recipient.audienceMode);
      const template = notificationProjectionTemplate(descriptor.templateKey);
      const parametersCanonical = '{}' as const;
      const bodyCanonical = canonicalNotificationPayload({
        parameters: {},
        templateDigest: template.sha256,
        templateKey: descriptor.templateKey,
        templateRevision: template.revision,
      });
      const bodyByteCount = Math.max(utf8Bytes(bodyCanonical), template.maximumRenderedBytes);
      if (bodyByteCount > PROJECTION_LIMITS.bodyBytes)
        throw new RangeError('notification_body_overflow');
      const bodySha256 = sha256(bodyCanonical);
      const authoritySha256 = authorityDigest({
        adapterRevision: subject.adapterRevision,
        audienceMode: recipient.audienceMode,
        event: {
          catalogRevision: input.event.catalog_revision,
          id: input.event.id,
          kind: input.event.kind,
          organizationId: input.event.organization_id,
          schemaVersion: input.event.schema_version,
          subjectId: input.event.subject_id,
          subjectRevision: input.event.subject_revision,
          subjectType: input.event.subject_type,
        },
        navigationId: descriptor.navigationId,
        recipient: recipient.profileId,
        recipientEvidence: JSON.parse(recipient.evidence) as unknown,
        template: {
          digest: template.sha256,
          key: descriptor.templateKey,
          revision: template.revision,
        },
      });
      const candidateSha256 = candidateDigest([
        input.event.organization_id,
        input.event.id,
        NOTIFICATION_PROJECTION_KIND,
        recipient.profileId,
        recipient.audienceMode,
        subject.adapterRevision,
        authoritySha256,
        descriptor.templateKey,
        template.revision,
        template.sha256,
        parametersCanonical,
        descriptor.navigationId,
        bodySha256,
        bodyByteCount,
      ]);
      return Object.freeze({
        recipientProfileId: recipient.profileId,
        audienceMode: recipient.audienceMode,
        adapterRevision: subject.adapterRevision,
        authoritySha256,
        templateKey: descriptor.templateKey,
        templateRevision: template.revision,
        templateSha256: template.sha256,
        parametersCanonical,
        navigationId: descriptor.navigationId,
        bodySha256,
        bodyByteCount,
        candidateSha256,
      });
    });
  return Object.freeze({ state: 'ready', candidates: Object.freeze(candidates) });
}

export function projectionSetDigest(candidates: readonly ProjectionCandidate[]): string {
  const ordered = [...candidates]
    .sort((left, right) =>
      left.recipientProfileId === right.recipientProfileId
        ? left.candidateSha256.localeCompare(right.candidateSha256, 'en-US')
        : left.recipientProfileId.localeCompare(right.recipientProfileId, 'en-US'),
    )
    .map((candidate) => candidate.candidateSha256);
  return sha256(JSON.stringify(ordered));
}
