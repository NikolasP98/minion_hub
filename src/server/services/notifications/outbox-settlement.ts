import { UUID_PATTERN } from '$lib/notifications/fields';
import { type NotificationLeaseReceipt } from './outbox-claim';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
  type NotificationWorkerTx,
} from './worker-transaction';

export type NotificationQuarantineReason =
  'payload_invalid' | 'digest_mismatch' | 'envelope_invalid';
function assertLease(scope: NotificationWorkerScope, lease: NotificationLeaseReceipt) {
  if (
    !UUID_PATTERN.test(lease.eventId) ||
    lease.ownerId !== scope.ownerId ||
    !/^[1-9][0-9]{0,18}$/.test(lease.generation) ||
    BigInt(lease.generation) > 9223372036854775807n
  )
    throw new Error('Invalid notification lease receipt');
}

/** An expired/stale receipt changes zero rows, even if a newer generation uses the same owner. */
export async function settleNotificationEventInTransaction(
  tx: NotificationWorkerTx,
  scope: NotificationWorkerScope,
  lease: NotificationLeaseReceipt,
  outcome: 'projected' | NotificationQuarantineReason,
): Promise<boolean> {
  assertLease(scope, lease);
  if (!['projected', 'payload_invalid', 'digest_mismatch', 'envelope_invalid'].includes(outcome))
    throw new Error('Invalid notification settlement');
  if (outcome !== 'projected') {
    return (
      (await quarantineNotificationEventsInTransaction(tx, scope, [{ lease, reason: outcome }])) ===
      1
    );
  }
  await tx`select set_config('app.notification_generation',${lease.generation},true)`;
  const rows =
    await tx`update public.notification_outbox set state=${outcome === 'projected' ? 'projected' : 'quarantined'},
    completed_at=clock_timestamp(),quarantine_reason=${outcome === 'projected' ? null : outcome},
    lease_owner=null,claimed_at=null,hard_deadline=null,lease_expires_at=null,renewal_count=null
    where event_id=${lease.eventId}::uuid and organization_id=${scope.organizationId}::uuid and state='processing'
    and lease_owner=${scope.ownerId}::uuid and generation=${lease.generation}::bigint
    and lease_expires_at>clock_timestamp()`;
  // The terminal row is deliberately hidden from the claim role. The exact command tag retains
  // stale-owner/generation admission without reopening post-settlement SELECT authority.
  return rows.count === 1;
}

/** Batch only malformed current-catalog claims; no successful projection is synthesized here. */
export async function quarantineNotificationEventsInTransaction(
  tx: NotificationWorkerTx,
  scope: NotificationWorkerScope,
  rejected: readonly Readonly<{
    lease: NotificationLeaseReceipt;
    reason: NotificationQuarantineReason;
  }>[],
): Promise<number> {
  if (rejected.length === 0) return 0;
  if (rejected.length > 250) throw new Error('Invalid notification quarantine batch');
  const ids = new Set<string>();
  const claims = rejected.map(({ lease, reason }) => {
    assertLease(scope, lease);
    if (
      ids.has(lease.eventId) ||
      !['payload_invalid', 'digest_mismatch', 'envelope_invalid'].includes(reason)
    )
      throw new Error('Invalid notification quarantine batch');
    ids.add(lease.eventId);
    return { eventId: lease.eventId, generation: lease.generation, reason };
  });
  const [result] = await tx<
    { settled: number }[]
  >`select public.notification_quarantine_claims(${tx.json(claims)}::jsonb) as settled`;
  return result.settled;
}

export function settleNotificationEvent(
  scope: NotificationWorkerScope,
  lease: NotificationLeaseReceipt,
  outcome: 'projected' | NotificationQuarantineReason,
) {
  return withNotificationWorkerTransaction(scope, (tx) =>
    settleNotificationEventInTransaction(tx, scope, lease, outcome),
  );
}

export function renewNotificationEvent(
  scope: NotificationWorkerScope,
  lease: NotificationLeaseReceipt,
) {
  assertLease(scope, lease);
  return withNotificationWorkerTransaction(scope, async (tx) => {
    await tx`select set_config('app.notification_generation',${lease.generation},true)`;
    const rows = await tx<
      { expires_at: string }[]
    >`update public.notification_outbox set renewal_count=1,lease_expires_at=hard_deadline
      where event_id=${lease.eventId}::uuid and organization_id=${scope.organizationId}::uuid and state='processing'
      and lease_owner=${scope.ownerId}::uuid and generation=${lease.generation}::bigint and renewal_count=0 and lease_expires_at>clock_timestamp()
      returning to_char(lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at`;
    return rows[0] ? Object.freeze({ ...lease, expiresAt: rows[0].expires_at }) : null;
  });
}
