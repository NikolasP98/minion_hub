import { createHash } from 'node:crypto';
import {
  canonicalNotificationPayload,
  NotificationInputError,
  type CanonicalValue,
} from '$lib/notifications/canonical';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATALOG_REVISION,
  notificationKind,
  parseNotificationPayload,
  type NotificationKind,
  type NotificationPayload,
} from '$lib/notifications/catalog';
import { admitFields, UUID_PATTERN } from '$lib/notifications/fields';

type SourceInput = {
  subjectRevision: string;
  sourceIdentity: string;
  occurredAt: string;
  dedupeKey: string;
};
export type NotificationEventInput = {
  [K in NotificationKind]: SourceInput & { kind: K; payload: NotificationPayload<K> };
}[NotificationKind];
export type AdmittedEvent = Readonly<{
  organizationId: string;
  kind: NotificationKind;
  schemaVersion: number;
  catalogRevision: string;
  producerId: string;
  subjectType: string;
  subjectId: string;
  subjectRevision: string;
  sourceIdentity: string;
  occurredAt: string;
  dedupeKey: string;
  payloadCanonical: string;
  payloadSha256: string;
  semanticSha256: string;
}>;
export function notificationDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function admitNotificationEvent(
  organizationId: string,
  input: NotificationEventInput,
): AdmittedEvent {
  if (!UUID_PATTERN.test(organizationId))
    throw new NotificationInputError('invalid_field', '$.organizationId');
  // Snapshot descriptors before reading caller fields; accessors/toJSON must never execute.
  const copy = JSON.parse(canonicalNotificationPayload(input)) as Record<string, CanonicalValue>;
  if (!copy || typeof copy !== 'object' || Array.isArray(copy))
    throw new NotificationInputError('invalid_object');
  const keys = Object.keys(copy);
  if (
    keys.length !== 6 ||
    keys.some(
      (key) =>
        ![
          'kind',
          'payload',
          'subjectRevision',
          'sourceIdentity',
          'occurredAt',
          'dedupeKey',
        ].includes(key),
    ) ||
    typeof copy.kind !== 'string'
  )
    throw new NotificationInputError('invalid_field');
  const kind = notificationKind(copy.kind);
  const definition = NOTIFICATION_CATALOG[kind];
  admitFields(
    { subjectRevision: 'revision', sourceIdentity: 'revision', occurredAt: 'instant' },
    {
      subjectRevision: copy.subjectRevision,
      sourceIdentity: copy.sourceIdentity,
      occurredAt: copy.occurredAt,
    },
  );
  if (
    typeof copy.dedupeKey !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,255}$/.test(copy.dedupeKey)
  )
    throw new NotificationInputError('invalid_field', '$.dedupeKey');
  const parsed = parseNotificationPayload(kind, copy.payload);
  const payload = parsed.payload as unknown as Readonly<Record<string, CanonicalValue>>;
  if ('revisionField' in definition && payload[definition.revisionField] !== copy.subjectRevision)
    throw new NotificationInputError('invalid_field', '$.subjectRevision');
  const subjectId = payload[definition.subjectField];
  if (typeof subjectId !== 'string' || !UUID_PATTERN.test(subjectId))
    throw new NotificationInputError('invalid_field', '$.subjectId');
  const fields = {
    organizationId,
    kind,
    schemaVersion: definition.schemaVersion,
    catalogRevision: NOTIFICATION_CATALOG_REVISION,
    producerId: definition.producer,
    subjectType: definition.subject,
    subjectId,
    subjectRevision: copy.subjectRevision as string,
    sourceIdentity: copy.sourceIdentity as string,
    occurredAt: copy.occurredAt as string,
    dedupeKey: copy.dedupeKey,
    payloadCanonical: parsed.canonical,
    payloadSha256: notificationDigest(parsed.canonical),
  };
  return Object.freeze({
    ...fields,
    semanticSha256: notificationDigest(canonicalNotificationPayload(fields)),
  });
}
