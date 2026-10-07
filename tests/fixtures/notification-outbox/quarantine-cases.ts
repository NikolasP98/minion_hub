import { expect } from 'vitest';
import { notificationIntegrityFailure } from '$server/services/notifications/event-integrity';
import {
  claimNotificationEventsForOrg,
  claimNotificationEventsInTransaction,
  type NotificationLeaseReceipt,
} from '$server/services/notifications/outbox-claim';
import {
  quarantineNotificationEventsInTransaction,
  type NotificationQuarantineReason,
} from '$server/services/notifications/outbox-settlement';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
} from '$server/services/notifications/worker-transaction';
import {
  OUTBOX_ORG_A,
  OUTBOX_ORG_B,
  OUTBOX_OWNER_A,
  resetNotificationOutbox,
  type NotificationOutboxHarness,
} from './postgres-harness';
import { captureTransactionSql, type CapturedTaggedQuery } from './query-capture';
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  bulkInsertRawEvents,
  expireProcessingEvent,
  insertRawEvent,
} from './runtime-harness';

const SCOPE_A = Object.freeze({ organizationId: OUTBOX_ORG_A, ownerId: OUTBOX_OWNER_A });
const SCOPE_B = Object.freeze({ organizationId: OUTBOX_ORG_B, ownerId: OUTBOX_OWNER_A });

type QuarantineClaim = Readonly<{
  lease: NotificationLeaseReceipt;
  reason: NotificationQuarantineReason;
}>;

function asClaim(
  lease: QuarantineClaim['lease'],
  reason: NotificationQuarantineReason = 'digest_mismatch',
): QuarantineClaim {
  return Object.freeze({ lease, reason });
}

async function rawClaim(harness: NotificationOutboxHarness, scope: NotificationWorkerScope) {
  return withNotificationWorkerTransaction(scope, (tx) =>
    claimNotificationEventsInTransaction(tx, scope, [CURRENT_CATALOG_REVISION]),
  );
}

async function quarantineExactly(
  scope: NotificationWorkerScope,
  claims: readonly QuarantineClaim[],
) {
  return withNotificationWorkerTransaction(scope, async (tx) => {
    const changed = await quarantineNotificationEventsInTransaction(tx, scope, claims);
    if (changed !== claims.length) throw new Error('Notification quarantine lease expired');
    return changed;
  });
}

export async function verifyFiniteMalformedRows(harness: NotificationOutboxHarness) {
  await asApplicationRole(harness.source, OUTBOX_ORG_A, async (tx) => {
    await insertRawEvent(tx, {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'bad-payload',
      payloadCanonical: '{"unexpected":"value"}',
    });
    await insertRawEvent(tx, {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'bad-envelope',
      schemaVersion: 2,
    });
    await insertRawEvent(tx, {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'bad-semantic-digest',
    });
  });
}

export async function verifyBoundedQuarantineBatch(harness: NotificationOutboxHarness) {
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 250,
    dedupePrefix: 'quarantine-batch',
  });
  const publicBatch = await claimNotificationEventsForOrg(SCOPE_A);
  expect(publicBatch.events).toEqual([]);
  expect(publicBatch.quarantined).toBe(250);
  expect(
    await harness.owner`select state,quarantine_reason,count(*)::int as count
      from public.notification_outbox group by state,quarantine_reason`,
  ).toEqual([{ state: 'quarantined', quarantine_reason: 'digest_mismatch', count: 250 }]);

  await resetNotificationOutbox(harness);
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 250,
    dedupePrefix: 'quarantine-captured-batch',
  });
  const claimed = await rawClaim(harness, SCOPE_A);
  expect(claimed.events).toHaveLength(250);
  const rejected = claimed.events.map((event) => {
    const reason = notificationIntegrityFailure(event);
    expect(reason).toBe('digest_mismatch');
    return asClaim(event.lease, reason ?? 'envelope_invalid');
  });
  const captures: CapturedTaggedQuery[] = [];
  const settled = await withNotificationWorkerTransaction(SCOPE_A, async (tx) => {
    const captured = captureTransactionSql(tx, captures);
    return quarantineNotificationEventsInTransaction(captured, SCOPE_A, rejected);
  });
  expect(settled).toBe(250);
  expect(
    captures.filter((capture) => capture.normalized.includes('notification_quarantine_claims')),
  ).toHaveLength(1);
  expect(
    await harness.owner`select state,quarantine_reason,count(*)::int as count
      from public.notification_outbox group by state,quarantine_reason`,
  ).toEqual([{ state: 'quarantined', quarantine_reason: 'digest_mismatch', count: 250 }]);

  const [grants] = await harness.owner<
    {
      worker: boolean;
      ledger: boolean;
      assistant: boolean;
      anonymous: boolean;
      authenticated: boolean;
      service: boolean;
    }[]
  >`select
    has_function_privilege('notification_worker','public.notification_quarantine_claims(jsonb)','EXECUTE') as worker,
    has_function_privilege('app_ledger','public.notification_quarantine_claims(jsonb)','EXECUTE') as ledger,
    has_function_privilege('app_assistant_ro','public.notification_quarantine_claims(jsonb)','EXECUTE') as assistant,
    has_function_privilege('anon','public.notification_quarantine_claims(jsonb)','EXECUTE') as anonymous,
    has_function_privilege('authenticated','public.notification_quarantine_claims(jsonb)','EXECUTE') as authenticated,
    has_function_privilege('service_role','public.notification_quarantine_claims(jsonb)','EXECUTE') as service`;
  expect(grants).toEqual({
    worker: true,
    ledger: false,
    assistant: false,
    anonymous: false,
    authenticated: false,
    service: false,
  });

  await resetNotificationOutbox(harness);
  const [eventA, eventB] = await Promise.all([
    asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
      insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: 'quarantine-org-a' }),
    ),
    asApplicationRole(harness.source, OUTBOX_ORG_B, (tx) =>
      insertRawEvent(tx, { organizationId: OUTBOX_ORG_B, dedupeKey: 'quarantine-org-b' }),
    ),
  ]);
  const claimA = (await rawClaim(harness, SCOPE_A)).events.find((event) => event.id === eventA);
  const claimB = (await rawClaim(harness, SCOPE_B)).events.find((event) => event.id === eventB);
  expect(claimA).toBeDefined();
  expect(claimB).toBeDefined();

  const duplicate = asClaim(claimA!.lease);
  await expect(
    withNotificationWorkerTransaction(
      SCOPE_A,
      (tx) =>
        tx`select public.notification_quarantine_claims(${tx.json([
          {
            eventId: duplicate.lease.eventId,
            generation: duplicate.lease.generation,
            reason: duplicate.reason,
          },
          {
            eventId: duplicate.lease.eventId,
            generation: duplicate.lease.generation,
            reason: duplicate.reason,
          },
        ])}::jsonb)`,
    ),
  ).rejects.toThrow();

  await expect(
    quarantineExactly(SCOPE_A, [asClaim(claimA!.lease), asClaim(claimB!.lease)]),
  ).rejects.toThrow('Notification quarantine lease expired');
  expect(
    await harness.owner`select event_id,state,generation::text from public.notification_outbox
      where event_id=any(${[eventA, eventB]}::uuid[]) order by event_id`,
  ).toEqual(
    [eventA, eventB].sort().map((event_id) => ({ event_id, state: 'processing', generation: '1' })),
  );

  await expect(
    asApplicationRole(
      harness.source,
      OUTBOX_ORG_A,
      (tx) =>
        tx`select public.notification_quarantine_claims(${tx.json([
          {
            eventId: claimA!.lease.eventId,
            generation: claimA!.lease.generation,
            reason: 'digest_mismatch',
          },
        ])}::jsonb)`,
    ),
  ).rejects.toThrow();

  await expireProcessingEvent(harness, eventA);
  const reclaimedA = (await rawClaim(harness, SCOPE_A)).events.find((event) => event.id === eventA);
  expect(reclaimedA?.lease.generation).toBe('2');
  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: 'quarantine-live-peer' }),
  );
  const livePeer = (await rawClaim(harness, SCOPE_A)).events[0];
  expect(livePeer).toBeDefined();
  await expect(
    quarantineExactly(SCOPE_A, [asClaim(claimA!.lease), asClaim(livePeer.lease)]),
  ).rejects.toThrow('Notification quarantine lease expired');
  expect(
    await harness.owner`select event_id as "eventId",state,generation::text from public.notification_outbox
      where event_id=any(${[eventA, livePeer.id]}::uuid[]) order by event_id`,
  ).toEqual(
    [
      { eventId: eventA, state: 'processing', generation: '2' },
      { eventId: livePeer.id, state: 'processing', generation: '1' },
    ].sort((left, right) => left.eventId.localeCompare(right.eventId)),
  );
}
