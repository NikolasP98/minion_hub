import type { NotificationKind, NotificationPayload } from '$lib/notifications/catalog';
import type { NotificationEventInput } from '$server/services/notifications/event-envelope';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const INSTANT = '2026-10-03T10:00:00.000Z';

function input<K extends NotificationKind>(
  index: number,
  kind: K,
  subjectRevision: string,
  payload: NotificationPayload<K>,
): Extract<NotificationEventInput, { kind: K }> {
  return {
    kind,
    subjectRevision,
    sourceIdentity: `catalog-source-${index}`,
    occurredAt: INSTANT,
    dedupeKey: `catalog-${index}`,
    payload,
  } as Extract<NotificationEventInput, { kind: K }>;
}

/** Reviewed product-contract vectors; payloads are not generated from the runtime validators. */
export const CATALOG_EVENT_INPUTS = Object.freeze([
  input(1, 'scheduling.booking.upcoming', 'v1', {
    bookingId: ID,
    bookingRevision: 'v1',
    windowKey: '2026-10-03',
    scheduledFor: INSTANT,
  }),
  input(2, 'domain.status.changed', 'v2', {
    adapter: 'scheduling.booking',
    bookingId: ID,
    bookingRevision: 'v2',
    fromStatus: 'pending',
    toStatus: 'accepted',
  }),
  input(3, 'stock.low.crossed', 'v1', {
    itemId: ID,
    warehouseId: OTHER_ID,
    crossingId: ID,
    policyRevision: 'v1',
    snapshotId: ID,
  }),
  input(4, 'join.requested', 'v1', {
    requestId: ID,
    applicantProfileId: OTHER_ID,
  }),
  input(5, 'join.approved', 'v1', {
    requestId: ID,
    applicantProfileId: OTHER_ID,
    decidedAt: INSTANT,
  }),
  input(6, 'join.denied', 'v1', {
    requestId: ID,
    applicantProfileId: OTHER_ID,
    decidedAt: INSTANT,
  }),
  input(7, 'membership.activated', 'v1', {
    profileId: ID,
    grantedRoleKeys: ['manager'],
    membershipRevision: 'v1',
  }),
  input(8, 'finance.daily_summary.ready', 'v1', {
    snapshotId: ID,
    localDate: '2026-10-03',
    currency: 'PEN',
  }),
  input(9, 'stock.daily_summary.ready', 'v1', {
    snapshotId: ID,
    localDate: '2026-10-03',
  }),
  input(10, 'release.product.published', 'v1', {
    releaseId: ID,
    version: 'v1.2.0',
    releaseClass: 'minor',
    artifactDigest: 'a'.repeat(64),
    publicationReceiptId: OTHER_ID,
    publishedAt: INSTANT,
  }),
  input(11, 'release.gateway.available', 'v1', {
    releaseId: ID,
    version: 'v1.2.0',
    artifactDigest: 'a'.repeat(64),
    publicationReceiptId: OTHER_ID,
    publishedAt: INSTANT,
    feedRevision: 'v1',
  }),
  input(12, 'automation.schedule.committed', 'v1', {
    scheduleId: ID,
    scheduleRevision: 'v1',
    ownerProfileId: OTHER_ID,
  }),
  input(13, 'automation.run.failed', 'v1', {
    runId: ID,
    ownerProfileId: OTHER_ID,
    failureClass: 'deadline_exceeded',
  }),
  input(14, 'automation.effects.committed', 'v1', {
    runId: ID,
    ownerProfileId: OTHER_ID,
    effectReceiptIds: [ID, OTHER_ID],
  }),
  input(15, 'agent.user_notice', 'v1', {
    snapshotId: ID,
    recipientProfileId: OTHER_ID,
    authorProfileId: ID,
  }),
  input(16, 'agent.report.ready', 'v1', {
    snapshotId: ID,
    planId: OTHER_ID,
    planRevision: 'v1',
    slotId: ID,
  }),
] satisfies readonly NotificationEventInput[]);
