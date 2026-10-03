import type { NotificationCapabilityPolicy } from './policy-contracts';
import {
  canonicalNotificationPayload,
  decodeNotificationPayload,
  NotificationInputError,
  type CanonicalValue,
} from './canonical';
import {
  admitFields,
  BOOKING_STATUS_VALUES,
  FAILURE_CLASSES,
  type FieldRule,
  type PayloadForFields,
} from './fields';

export const NOTIFICATION_CATALOG_REVISION = '2026-10-03.1';
type EntryInput = {
  subject: string;
  subjectField: string;
  revisionField?: string;
  producer: string;
  audience: string;
  capabilityPolicy: NotificationCapabilityPolicy;
  privacy: string;
  navigation: string;
  template: string;
  retention: 'operational' | 'financial' | 'release';
  fields: Readonly<Record<string, FieldRule>>;
};
function entry<const T extends EntryInput>(value: T) {
  for (const rule of Object.values(value.fields)) {
    if (typeof rule === 'object') {
      if ('values' in rule) Object.freeze(rule.values);
      Object.freeze(rule);
    }
  }
  Object.freeze(value.fields);
  return Object.freeze({ ...value, schemaVersion: 1 as const, integrated: false as const });
}

/** The single registry drives validation and later UI/worker coverage; false means NOT wired. */
export const NOTIFICATION_CATALOG = Object.freeze({
  'scheduling.booking.upcoming': entry({
    subject: 'booking',
    subjectField: 'bookingId',
    revisionField: 'bookingRevision',
    producer: 'scheduling.reminder',
    audience: 'booking.participants',
    capabilityPolicy: 'booking.read',
    privacy: 'booking.authorized',
    navigation: 'booking.detail',
    template: 'booking.upcoming',
    retention: 'operational',
    fields: {
      bookingId: 'uuid',
      bookingRevision: 'revision',
      windowKey: 'revision',
      scheduledFor: 'instant',
    },
  }),
  'domain.status.changed': entry({
    subject: 'booking',
    subjectField: 'bookingId',
    revisionField: 'bookingRevision',
    producer: 'scheduling.status',
    audience: 'subject.subscribers',
    capabilityPolicy: 'booking.read',
    privacy: 'booking.authorized',
    navigation: 'booking.detail',
    template: 'booking.status_changed',
    retention: 'operational',
    fields: {
      adapter: { values: ['scheduling.booking'] },
      bookingId: 'uuid',
      bookingRevision: 'revision',
      fromStatus: { values: BOOKING_STATUS_VALUES },
      toStatus: { values: BOOKING_STATUS_VALUES },
    },
  }),
  'stock.low.crossed': entry({
    subject: 'stock_item',
    subjectField: 'itemId',
    producer: 'stock.threshold',
    audience: 'stock.managers',
    capabilityPolicy: 'stock.read',
    privacy: 'stock.authorized',
    navigation: 'stock.item',
    template: 'stock.low',
    retention: 'operational',
    fields: {
      itemId: 'uuid',
      warehouseId: 'uuid',
      crossingId: 'uuid',
      policyRevision: 'revision',
      snapshotId: 'uuid',
    },
  }),
  'join.requested': entry({
    subject: 'join_request',
    subjectField: 'requestId',
    producer: 'membership.join',
    audience: 'membership.managers',
    capabilityPolicy: 'users.manage',
    privacy: 'join.manager',
    navigation: 'join.review',
    template: 'join.requested',
    retention: 'operational',
    fields: { requestId: 'uuid', applicantProfileId: 'uuid' },
  }),
  'join.approved': entry({
    subject: 'join_request',
    subjectField: 'requestId',
    producer: 'membership.join',
    audience: 'join.applicant_and_authorized_managers',
    capabilityPolicy: 'subject.or_users_manage',
    privacy: 'join.applicant',
    navigation: 'join.status',
    template: 'join.approved',
    retention: 'operational',
    fields: { requestId: 'uuid', applicantProfileId: 'uuid', decidedAt: 'instant' },
  }),
  'join.denied': entry({
    subject: 'join_request',
    subjectField: 'requestId',
    producer: 'membership.join',
    audience: 'join.applicant_and_authorized_managers',
    capabilityPolicy: 'subject.or_users_manage',
    privacy: 'join.applicant',
    navigation: 'join.status',
    template: 'join.denied',
    retention: 'operational',
    fields: { requestId: 'uuid', applicantProfileId: 'uuid', decidedAt: 'instant' },
  }),
  'membership.activated': entry({
    subject: 'member',
    subjectField: 'profileId',
    revisionField: 'membershipRevision',
    producer: 'membership.activation',
    audience: 'membership.subject_and_authorized_managers',
    capabilityPolicy: 'subject.or_users_manage',
    privacy: 'membership.manager',
    navigation: 'member.detail',
    template: 'membership.activated',
    retention: 'operational',
    fields: {
      profileId: 'uuid',
      grantedRoleKeys: { items: 'role', maximum: 32 },
      membershipRevision: 'revision',
    },
  }),
  'finance.daily_summary.ready': entry({
    subject: 'finance_snapshot',
    subjectField: 'snapshotId',
    producer: 'finance.daily_summary',
    audience: 'finance.authorized',
    capabilityPolicy: 'finance.read',
    privacy: 'finance.currency_snapshot',
    navigation: 'report.board',
    template: 'finance.daily_summary',
    retention: 'financial',
    fields: { snapshotId: 'uuid', localDate: 'date', currency: 'currency' },
  }),
  'stock.daily_summary.ready': entry({
    subject: 'stock_snapshot',
    subjectField: 'snapshotId',
    producer: 'stock.daily_summary',
    audience: 'stock.managers',
    capabilityPolicy: 'stock.read',
    privacy: 'stock.snapshot',
    navigation: 'report.board',
    template: 'stock.daily_summary',
    retention: 'operational',
    fields: { snapshotId: 'uuid', localDate: 'date' },
  }),
  'release.product.published': entry({
    subject: 'product_release',
    subjectField: 'releaseId',
    producer: 'release.product',
    audience: 'product.users',
    capabilityPolicy: 'release.active_member',
    privacy: 'release.public',
    navigation: 'release.board',
    template: 'release.product',
    retention: 'release',
    fields: {
      releaseId: 'uuid',
      version: 'revision',
      releaseClass: { values: ['minor', 'major'] },
      artifactDigest: 'digest',
      publicationReceiptId: 'uuid',
      publishedAt: 'instant',
    },
  }),
  'release.gateway.available': entry({
    subject: 'gateway_release',
    subjectField: 'releaseId',
    producer: 'release.gateway',
    audience: 'gateway.operators',
    capabilityPolicy: 'gateway.operator',
    privacy: 'release.operator',
    navigation: 'release.board',
    template: 'release.gateway',
    retention: 'release',
    fields: {
      releaseId: 'uuid',
      version: 'revision',
      artifactDigest: 'digest',
      publicationReceiptId: 'uuid',
      publishedAt: 'instant',
      feedRevision: 'revision',
    },
  }),
  'automation.schedule.committed': entry({
    subject: 'automation_schedule',
    subjectField: 'scheduleId',
    revisionField: 'scheduleRevision',
    producer: 'automation.schedule',
    audience: 'automation.owner_or_authorized_operator',
    capabilityPolicy: 'automation.owner_or_operator',
    privacy: 'automation.owner',
    navigation: 'automation.detail',
    template: 'automation.schedule',
    retention: 'operational',
    fields: { scheduleId: 'uuid', scheduleRevision: 'revision', ownerProfileId: 'uuid' },
  }),
  'automation.run.failed': entry({
    subject: 'automation_run',
    subjectField: 'runId',
    producer: 'automation.run',
    audience: 'automation.owner_or_authorized_operator',
    capabilityPolicy: 'automation.owner_or_operator',
    privacy: 'automation.owner',
    navigation: 'automation.detail',
    template: 'automation.failed',
    retention: 'operational',
    fields: { runId: 'uuid', ownerProfileId: 'uuid', failureClass: { values: FAILURE_CLASSES } },
  }),
  'automation.effects.committed': entry({
    subject: 'automation_run',
    subjectField: 'runId',
    producer: 'automation.effects',
    audience: 'automation.authorized',
    capabilityPolicy: 'effects.all_sources',
    privacy: 'automation.receipts',
    navigation: 'automation.detail',
    template: 'automation.effects',
    retention: 'operational',
    fields: {
      runId: 'uuid',
      ownerProfileId: 'uuid',
      effectReceiptIds: { items: 'uuid', maximum: 128 },
    },
  }),
  'agent.user_notice': entry({
    subject: 'notice_snapshot',
    subjectField: 'snapshotId',
    producer: 'agent.notice',
    audience: 'notice.recipient',
    capabilityPolicy: 'notice.authorized',
    privacy: 'notice.authorized',
    navigation: 'notice.board',
    template: 'agent.notice',
    retention: 'operational',
    fields: { snapshotId: 'uuid', recipientProfileId: 'uuid', authorProfileId: 'uuid' },
  }),
  'agent.report.ready': entry({
    subject: 'report_snapshot',
    subjectField: 'snapshotId',
    producer: 'agent.report',
    audience: 'report.reviewed_audience',
    capabilityPolicy: 'report.all_sources',
    privacy: 'report.authorized_snapshot',
    navigation: 'report.board',
    template: 'agent.report',
    retention: 'operational',
    fields: { snapshotId: 'uuid', planId: 'uuid', planRevision: 'revision', slotId: 'uuid' },
  }),
});

export type NotificationKind = keyof typeof NOTIFICATION_CATALOG;
export type NotificationPayload<K extends NotificationKind> = PayloadForFields<
  (typeof NOTIFICATION_CATALOG)[K]['fields']
>;
export const NOTIFICATION_KINDS = Object.freeze(
  Object.keys(NOTIFICATION_CATALOG) as NotificationKind[],
);

export function notificationKind(value: string): NotificationKind {
  if (!Object.hasOwn(NOTIFICATION_CATALOG, value)) throw new NotificationInputError('unknown_kind');
  return value as NotificationKind;
}

export function parseNotificationPayload<K extends NotificationKind>(
  kind: K,
  input: unknown,
  version = 1,
  revision = NOTIFICATION_CATALOG_REVISION,
): { readonly payload: NotificationPayload<K>; readonly canonical: string } {
  const definition = NOTIFICATION_CATALOG[notificationKind(kind)];
  if (version !== definition.schemaVersion || revision !== NOTIFICATION_CATALOG_REVISION)
    throw new NotificationInputError('unsupported_version');
  const canonical = canonicalNotificationPayload(input);
  const copy = JSON.parse(canonical) as CanonicalValue;
  admitFields(definition.fields, copy);
  if (kind === 'domain.status.changed') {
    const transition = copy as Record<string, CanonicalValue>;
    if (transition.fromStatus === transition.toStatus)
      throw new NotificationInputError('invalid_field', '$.toStatus');
  }
  // The fresh parsed copy has no references to caller-owned mutable data.
  for (const value of Object.values(copy as Record<string, CanonicalValue>))
    if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze({ payload: Object.freeze(copy) as NotificationPayload<K>, canonical });
}

export function parseEncodedNotificationPayload<K extends NotificationKind>(
  kind: K,
  encoded: string,
) {
  return parseNotificationPayload(kind, decodeNotificationPayload(encoded));
}

/** Public settings metadata deliberately excludes producer, privacy and resolver identities. */
export function notificationSettingsCatalog() {
  return NOTIFICATION_KINDS.map((kind) =>
    Object.freeze({
      kind,
      schemaVersion: 1,
      catalogRevision: NOTIFICATION_CATALOG_REVISION,
      template: NOTIFICATION_CATALOG[kind].template,
      available: NOTIFICATION_CATALOG[kind].integrated,
    }),
  );
}

// TODO(handoff): Domain producers and audience/template/navigation consumers must register their
// qualified adapters before integrated becomes true. See meta proposals/2026-10-03-notification-recon.md.
export function requireNotificationAdapter(kind: NotificationKind): never {
  notificationKind(kind);
  throw new NotificationInputError('unsupported_version');
}
