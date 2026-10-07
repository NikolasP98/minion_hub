import type {
  NotificationNavigationId,
  NotificationTemplateKey,
} from '$lib/notifications/projection-manifest';

export const PROJECTION_LIMITS = Object.freeze({
  supportTuples: 32,
  recipients: 10_000,
  recipientSentinel: 10_001,
  roleKeys: 256,
  rules: 256,
  rolesPerRecipient: 32,
  assignments: 100_000,
  authorityGroups: 256,
  authorityGroupBytes: 64 * 1024,
  authorityBundleBytes: 16 * 1024 * 1024,
  bodyBytes: 8192,
  bodyByteTotal: 81_920_000,
  statements: 16,
  wallMs: 40_000,
  preFinalizerMs: 37_000,
  finalizerMs: 3000,
  lockMs: 250,
  idleMs: 15_000,
  revalidationStatements: 8,
  revalidationWallMs: 10_000,
});

export const PROJECTION_QUARANTINE_REASONS = [
  'audience_overflow',
  'subject_invalid',
  'audience_authority_overflow',
  'body_invalid',
  'body_overflow',
  'navigation_invalid',
] as const;
export type ProjectionQuarantineReason = (typeof PROJECTION_QUARANTINE_REASONS)[number];

export const PROJECTION_OBSERVATIONS = [
  'committed',
  'same_generation_processing',
  'superseded',
  'quarantined',
  'terminal_unattributed',
  'pending',
  'absent',
  'integrity_failed',
] as const;
export type ProjectionObservation = (typeof PROJECTION_OBSERVATIONS)[number] | 'unavailable';

export type AudienceMode = 'users_manage' | 'join_applicant';
export type ProjectionCandidate = Readonly<{
  recipientProfileId: string;
  audienceMode: AudienceMode;
  adapterRevision: string;
  authoritySha256: string;
  templateKey: NotificationTemplateKey;
  templateRevision: string;
  templateSha256: string;
  parametersCanonical: '{}';
  navigationId: NotificationNavigationId;
  bodySha256: string;
  bodyByteCount: number;
  candidateSha256: string;
}>;

export type ProjectionReceipt = Readonly<{
  candidateCount: number;
  bodyByteTotal: number;
  candidateSetSha256: string;
}>;

export class NotificationProjectionUnavailable extends Error {
  readonly code = 'notification_projection_unavailable';
  constructor(
    readonly reason:
      | 'deadline'
      | 'scope_lost'
      | 'database_unavailable'
      | 'integrity_failed'
      | 'revalidation_unavailable',
  ) {
    super('Notification audience projection is unavailable');
    this.name = 'NotificationProjectionUnavailable';
  }
}
