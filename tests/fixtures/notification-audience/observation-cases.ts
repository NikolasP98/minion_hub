import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { reconcileNotificationProjection } from '$server/services/notifications/projection/reconcile';
import {
  resetNotificationAudienceOperationalState,
  type FixtureSqlParameter,
  type NotificationAudienceHarness,
} from './postgres-harness';
import { acquireScope, type ActiveProjection } from './runtime-cases';

async function nextScope(
  harness: NotificationAudienceHarness,
  seed: number,
): Promise<ActiveProjection> {
  await resetNotificationAudienceOperationalState(harness);
  return acquireScope(harness, seed, 'join.requested');
}

async function mutateOutbox(
  harness: NotificationAudienceHarness,
  sql: string,
  parameters: readonly FixtureSqlParameter[],
): Promise<void> {
  await harness.owner.unsafe(
    'alter table public.notification_outbox disable trigger notification_outbox_transition',
  );
  try {
    await harness.owner.unsafe(sql, [...parameters]);
  } finally {
    await harness.owner.unsafe(
      'alter table public.notification_outbox enable trigger notification_outbox_transition',
    );
  }
}

export async function verifyTerminalObservationGrammar(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const processing = await nextScope(harness, 121);
  expect(await reconcileNotificationProjection(processing)).toBe('same_generation_processing');

  const superseded = await nextScope(harness, 122);
  await mutateOutbox(
    harness,
    `update public.notification_outbox set lease_owner=$1::uuid,generation=generation+1,
       claim_count=claim_count+1
     where event_id=$2::uuid`,
    [randomUUID(), superseded.event.id],
  );
  expect(await reconcileNotificationProjection(superseded)).toBe('superseded');

  const pending = await nextScope(harness, 123);
  await mutateOutbox(
    harness,
    `update public.notification_outbox set state='pending',lease_owner=null,claimed_at=null,
       hard_deadline=null,lease_expires_at=null,renewal_count=null,generation=0,claim_count=0
     where event_id=$1::uuid`,
    [pending.event.id],
  );
  expect(await reconcileNotificationProjection(pending)).toBe('pending');

  const unattributed = await nextScope(harness, 124);
  await mutateOutbox(
    harness,
    `update public.notification_outbox set state='quarantined',completed_at=clock_timestamp(),
       quarantine_reason='subject_invalid',lease_owner=null,claimed_at=null,hard_deadline=null,
       lease_expires_at=null,renewal_count=null,terminal_owner_id=null,terminal_generation=null
     where event_id=$1::uuid`,
    [unattributed.event.id],
  );
  expect(await reconcileNotificationProjection(unattributed)).toBe('terminal_unattributed');

  const missingReceipt = await nextScope(harness, 125);
  await mutateOutbox(
    harness,
    `update public.notification_outbox set state='projected',completed_at=clock_timestamp(),
       quarantine_reason=null,terminal_owner_id=lease_owner,terminal_generation=generation,
       lease_owner=null,claimed_at=null,hard_deadline=null,lease_expires_at=null,renewal_count=null
     where event_id=$1::uuid`,
    [missingReceipt.event.id],
  );
  expect(await reconcileNotificationProjection(missingReceipt)).toBe('integrity_failed');

  const absentEventId = randomUUID();
  const absent = Object.freeze({
    ...missingReceipt,
    event: Object.freeze({
      ...missingReceipt.event,
      id: absentEventId,
      lease: Object.freeze({ ...missingReceipt.event.lease, eventId: absentEventId }),
    }),
  });
  expect(await reconcileNotificationProjection(absent)).toBe('absent');
}
