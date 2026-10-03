import { decodeNotificationPayload } from '$lib/notifications/canonical';
import { notificationKind } from '$lib/notifications/catalog';
import {
  admitNotificationEvent,
  notificationDigest,
  type NotificationEventInput,
} from './event-envelope';
import type { ClaimedNotificationEvent } from './outbox-claim';
import type { NotificationQuarantineReason } from './outbox-settlement';

/** Validate persisted evidence again before any audience sees it. No raw value enters the reason. */
export function notificationIntegrityFailure(
  event: ClaimedNotificationEvent,
): NotificationQuarantineReason | null {
  if (notificationDigest(event.payload_canonical) !== event.payload_sha256)
    return 'digest_mismatch';
  let input: NotificationEventInput;
  try {
    input = {
      kind: notificationKind(event.kind),
      payload: decodeNotificationPayload(event.payload_canonical),
      subjectRevision: event.subject_revision,
      sourceIdentity: event.source_identity,
      occurredAt: event.occurred_at,
      dedupeKey: event.dedupe_key,
    } as NotificationEventInput;
  } catch {
    return 'payload_invalid';
  }
  try {
    const admitted = admitNotificationEvent(event.organization_id, input);
    if (
      admitted.schemaVersion !== event.schema_version ||
      admitted.catalogRevision !== event.catalog_revision ||
      admitted.producerId !== event.producer_id ||
      admitted.subjectType !== event.subject_type ||
      admitted.subjectId !== event.subject_id
    )
      return 'envelope_invalid';
    if (
      admitted.payloadCanonical !== event.payload_canonical ||
      admitted.payloadSha256 !== event.payload_sha256 ||
      admitted.semanticSha256 !== event.semantic_sha256
    )
      return 'digest_mismatch';
    return null;
  } catch {
    return 'payload_invalid';
  }
}
