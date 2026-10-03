import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import {
  admitNotificationEvent,
  type AdmittedEvent,
  type NotificationEventInput,
} from './event-envelope';

export class NotificationEventConflict extends Error {
  readonly code = 'notification_event_conflict';
  constructor() {
    super('Notification event retry does not match the original source receipt');
  }
}
export type StoredNotificationEvent = Readonly<{
  id: string;
  organizationId: string;
  payloadCanonical: string;
  payloadSha256: string;
  semanticSha256: string;
  sourceTransactionId: string;
  createdAt: string;
}>;
type StoredRow = {
  id: string;
  organization_id: string;
  payload_canonical: string;
  payload_sha256: string;
  semantic_sha256: string;
  source_transaction_id: string;
  created_at: string;
};
function receipt(row: StoredRow): StoredNotificationEvent {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    payloadCanonical: row.payload_canonical,
    payloadSha256: row.payload_sha256,
    semanticSha256: row.semantic_sha256,
    sourceTransactionId: row.source_transaction_id,
    createdAt: row.created_at,
  });
}
const columns = sql`id,organization_id,payload_canonical,payload_sha256,semantic_sha256,source_transaction_id,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at`;

/** Must be awaited within the actual source mutation's withOrgCore transaction. Never opens one. */
export async function appendNotificationEvent(
  tx: CoreTx,
  source: { organizationId: string },
  input: NotificationEventInput,
): Promise<Readonly<{ inserted: boolean; event: StoredNotificationEvent }>> {
  try {
    return await appendInSourceTransaction(tx, source, input);
  } catch (error) {
    // Even a caller that catches the typed error cannot commit a source mutation without its
    // event. A SQL exception poisons the owned transaction; preserve the useful original error.
    try {
      await tx.execute(sql`select public.notification_event_abort_source_transaction()`);
    } catch {
      /* PostgreSQL now requires rollback; it may already have been aborted. */
    }
    throw error;
  }
}

async function appendInSourceTransaction(
  tx: CoreTx,
  source: { organizationId: string },
  input: NotificationEventInput,
): Promise<Readonly<{ inserted: boolean; event: StoredNotificationEvent }>> {
  const value: AdmittedEvent = admitNotificationEvent(source.organizationId, input);
  const [scope] = await tx.execute<{ role: string; org: string | null; isolation: string }>(
    sql`select current_user as role,current_setting('app.current_org_id',true) as org,current_setting('transaction_isolation') as isolation`,
  );
  if (
    scope?.role !== 'app_ledger' ||
    scope.org !== value.organizationId ||
    scope.isolation !== 'read committed'
  )
    throw new Error(
      'Notification event requires its owned READ COMMITTED organization transaction',
    );
  const inserted = await tx.execute<StoredRow>(sql`insert into public.notification_events
    (organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,semantic_sha256)
    values (${value.organizationId}::uuid,${value.kind},${value.schemaVersion},${value.catalogRevision},${value.producerId},${value.subjectType},${value.subjectId}::uuid,${value.subjectRevision},${value.sourceIdentity},${value.occurredAt}::timestamptz,${value.dedupeKey},${value.payloadCanonical},${value.payloadSha256},${value.semanticSha256})
    on conflict (organization_id,producer_id,dedupe_key) do nothing returning ${columns}`);
  if (inserted[0]) return Object.freeze({ inserted: true, event: receipt(inserted[0]) });
  // A fresh statement snapshot observes a concurrent winner that INSERT's snapshot could not.
  const [winner] = await tx.execute<StoredRow>(
    sql`select ${columns} from public.notification_events where organization_id=${value.organizationId}::uuid and producer_id=${value.producerId} and dedupe_key=${value.dedupeKey}`,
  );
  if (!winner) throw new Error('Notification event retry winner is unavailable');
  if (
    winner.semantic_sha256 !== value.semanticSha256 ||
    winner.payload_sha256 !== value.payloadSha256 ||
    winner.payload_canonical !== value.payloadCanonical
  )
    throw new NotificationEventConflict();
  return Object.freeze({ inserted: false, event: receipt(winner) });
}
