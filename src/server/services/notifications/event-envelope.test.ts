import { describe, expect, it } from 'vitest';
import { NotificationInputError } from '$lib/notifications/canonical';
import { admitNotificationEvent, type NotificationEventInput } from './event-envelope';
import { notificationIntegrityFailure } from './event-integrity';
import type { ClaimedNotificationEvent } from './outbox-claim';

const org = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const input: NotificationEventInput = {
  kind: 'join.requested',
  payload: { requestId: id, applicantProfileId: other },
  subjectRevision: 'v1',
  sourceIdentity: 'join-receipt-1',
  occurredAt: '2026-10-03T10:00:00.000Z',
  dedupeKey: 'join-request:' + id,
};
function stored(): ClaimedNotificationEvent {
  const v = admitNotificationEvent(org, input);
  return {
    id: other,
    organization_id: v.organizationId,
    kind: v.kind,
    schema_version: v.schemaVersion,
    catalog_revision: v.catalogRevision,
    producer_id: v.producerId,
    subject_type: v.subjectType,
    subject_id: v.subjectId,
    subject_revision: v.subjectRevision,
    source_identity: v.sourceIdentity,
    occurred_at: v.occurredAt,
    dedupe_key: v.dedupeKey,
    payload_canonical: v.payloadCanonical,
    payload_sha256: v.payloadSha256,
    semantic_sha256: v.semanticSha256,
    lease: {
      eventId: other,
      ownerId: org,
      generation: '1',
      expiresAt: '2026-10-03T10:00:30.000Z',
      hardDeadline: '2026-10-03T10:01:00.000Z',
    },
  };
}

describe('notification event source evidence', () => {
  it('derives subject and producer from the registry and binds the exact stable source receipt', () => {
    const event = admitNotificationEvent(org, input);
    expect(event.subjectId).toBe(id);
    expect(event.subjectType).toBe('join_request');
    expect(event.producerId).toBe('membership.join');
    expect(
      admitNotificationEvent(org, {
        ...input,
        payload: { applicantProfileId: other, requestId: id },
      }),
    ).toEqual(event);
    for (const changed of [
      { ...input, sourceIdentity: 'another' },
      { ...input, subjectRevision: 'v2' },
      { ...input, occurredAt: '2026-10-03T10:01:00.000Z' },
      { ...input, payload: { requestId: other, applicantProfileId: other } },
    ])
      expect(admitNotificationEvent(org, changed).semanticSha256).not.toBe(event.semanticSha256);
    expect(admitNotificationEvent(other, input).semanticSha256).not.toBe(event.semanticSha256);
    expect(Object.isFrozen(event)).toBe(true);
  });
  it('rejects field overflows and a booking revision different from its immutable envelope', () => {
    for (const [field, maximum] of [
      ['dedupeKey', 256],
      ['sourceIdentity', 128],
      ['subjectRevision', 128],
    ] as const) {
      expect(() =>
        admitNotificationEvent(org, { ...input, [field]: 'x'.repeat(maximum) }),
      ).not.toThrow();
      expect(() =>
        admitNotificationEvent(org, { ...input, [field]: 'x'.repeat(maximum + 1) }),
      ).toThrow(NotificationInputError);
      expect(() => admitNotificationEvent(org, { ...input, [field]: 'é' })).toThrow(
        NotificationInputError,
      );
    }
    const booking: NotificationEventInput = {
      ...input,
      kind: 'domain.status.changed',
      payload: {
        adapter: 'scheduling.booking',
        bookingId: id,
        bookingRevision: 'v2',
        fromStatus: 'pending',
        toStatus: 'accepted',
      },
    };
    expect(() => admitNotificationEvent(org, booking)).toThrow('invalid_field');
    expect(() => admitNotificationEvent(org, { ...booking, subjectRevision: 'v2' })).not.toThrow();
  });
  it('rejects forged envelope fields and caller accessors before reading their values', () => {
    let accessed = false;
    const dangerous = Object.defineProperty({ ...input }, 'sourceIdentity', {
      enumerable: true,
      get() {
        accessed = true;
        throw Error('private');
      },
    });
    expect(() => admitNotificationEvent(org, dangerous)).toThrow(NotificationInputError);
    expect(accessed).toBe(false);
    expect(() =>
      admitNotificationEvent(org, { ...input, producerId: 'forged' } as NotificationEventInput),
    ).toThrow(NotificationInputError);
    expect(() => admitNotificationEvent(org, null as unknown as NotificationEventInput)).toThrow(
      NotificationInputError,
    );
    expect(() => admitNotificationEvent('another-org', input)).toThrow(NotificationInputError);
  });
});

describe('persisted notification evidence admission', () => {
  it('admits the stored event while excluding database transaction and event UUID from semantic identity', () => {
    expect(notificationIntegrityFailure(stored())).toBe(null);
    expect(
      notificationIntegrityFailure({ ...stored(), id, lease: { ...stored().lease, eventId: id } }),
    ).toBe(null);
  });
  it('classifies corrupted payload/digest and forged routing metadata without echoing values', () => {
    expect(
      notificationIntegrityFailure({ ...stored(), payload_canonical: '{"secret":"private"}' }),
    ).toBe('digest_mismatch');
    expect(notificationIntegrityFailure({ ...stored(), semantic_sha256: 'b'.repeat(64) })).toBe(
      'digest_mismatch',
    );
    for (const field of ['producer_id', 'subject_id', 'subject_type'] as const)
      expect(notificationIntegrityFailure({ ...stored(), [field]: 'forged' })).toBe(
        'envelope_invalid',
      );
    expect(notificationIntegrityFailure({ ...stored(), schema_version: 2 })).toBe(
      'envelope_invalid',
    );
  });
});
