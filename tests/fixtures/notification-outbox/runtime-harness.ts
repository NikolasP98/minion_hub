import { createHash } from 'node:crypto';
import * as pgSchema from '@minion-stack/db/pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type { CoreTx } from '$server/db/with-org-core';
import { withOrgCoreTransaction } from '$server/db/with-org-core';
import type { NotificationEventInput } from '$server/services/notifications/event-envelope';
import type { NotificationOutboxHarness, PgClient } from './postgres-harness';

export const CURRENT_CATALOG_REVISION = '2026-10-03.1';
export const FUTURE_CATALOG_REVISION = '2026-10-03.2';
export const FIXED_OCCURRED_AT = '2026-10-03T12:00:00.000Z';

type TransactionSql = postgres.TransactionSql;

export function fixtureUuid(seed: number, group = 3) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 999_999_999_999) {
    throw new Error('Invalid notification fixture UUID seed');
  }
  return `${group}0000000-0000-4000-8000-${seed.toString().padStart(12, '0')}`;
}

export function joinRequestedInput(
  seed: number,
  overrides: Partial<NotificationEventInput> = {},
): NotificationEventInput {
  const requestId = fixtureUuid(seed, 3);
  return {
    kind: 'join.requested',
    subjectRevision: `join-revision-${seed}`,
    sourceIdentity: `join-source-${seed}`,
    occurredAt: FIXED_OCCURRED_AT,
    dedupeKey: `join-requested-${seed}`,
    payload: {
      requestId,
      applicantProfileId: fixtureUuid(seed, 4),
    },
    ...overrides,
  } as NotificationEventInput;
}

export async function inSourceTransaction<T>(
  harness: NotificationOutboxHarness,
  organizationId: string,
  fn: (tx: CoreTx) => Promise<T>,
) {
  const db = drizzle(harness.source, { schema: pgSchema });
  return db.transaction((tx) =>
    withOrgCoreTransaction({ tenantId: organizationId, profileId: null }, tx, fn),
  );
}

export async function insertSourceMutation(
  tx: CoreTx,
  organizationId: string,
  id: string,
  value: string,
) {
  await tx.execute(sql`insert into public.notification_source_fixture(id,organization_id,value)
    values (${id}::uuid,${organizationId}::uuid,${value})`);
}

export async function asApplicationRole<T>(
  client: PgClient,
  organizationId: string,
  fn: (tx: TransactionSql) => Promise<T>,
) {
  return client.begin(async (tx) => {
    await tx`select set_config('role','app_ledger',true),
      set_config('app.current_org_id',${organizationId},true),
      set_config('app.current_profile_id','',true)`;
    return fn(tx);
  });
}

const RAW_REQUEST_ID = '50000000-0000-4000-8000-000000000001';
const RAW_APPLICANT_ID = '60000000-0000-4000-8000-000000000001';
export const RAW_PAYLOAD = JSON.stringify({
  applicantProfileId: RAW_APPLICANT_ID,
  requestId: RAW_REQUEST_ID,
});
export const RAW_PAYLOAD_SHA256 = createHash('sha256').update(RAW_PAYLOAD).digest('hex');

export async function insertRawEvent(
  tx: TransactionSql,
  options: {
    organizationId: string;
    dedupeKey: string;
    catalogRevision?: string;
    schemaVersion?: number;
    payloadCanonical?: string;
    payloadSha256?: string;
    semanticSha256?: string;
    kind?: string;
    producerId?: string;
    subjectType?: string;
    subjectRevision?: string;
    sourceIdentity?: string;
  },
) {
  const payload = options.payloadCanonical ?? RAW_PAYLOAD;
  const payloadSha = options.payloadSha256 ?? createHash('sha256').update(payload).digest('hex');
  const [row] = await tx<{ id: string }[]>`insert into public.notification_events
    (organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
      subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
      semantic_sha256)
    values (
      ${options.organizationId}::uuid,${options.kind ?? 'join.requested'},
      ${options.schemaVersion ?? 1},${options.catalogRevision ?? CURRENT_CATALOG_REVISION},
      ${options.producerId ?? 'membership.join'},${options.subjectType ?? 'join_request'},
      ${RAW_REQUEST_ID}::uuid,${options.subjectRevision ?? 'raw-revision-1'},
      ${options.sourceIdentity ?? 'raw-source-1'},${FIXED_OCCURRED_AT}::timestamptz,
      ${options.dedupeKey},${payload},${payloadSha},${options.semanticSha256 ?? 'a'.repeat(64)}
    ) returning id`;
  if (!row) throw new Error('Raw notification event insert returned no row');
  return row.id;
}

export async function bulkInsertRawEvents(
  harness: NotificationOutboxHarness,
  options: {
    organizationId: string;
    count: number;
    dedupePrefix: string;
    catalogRevisions?: readonly string[];
    occurredAt?: string;
  },
) {
  const revisions = options.catalogRevisions ?? [CURRENT_CATALOG_REVISION];
  if (options.count < 1 || options.count > 100_000 || revisions.length < 1) {
    throw new Error('Invalid notification bulk fixture');
  }
  await asApplicationRole(harness.source, options.organizationId, async (tx) => {
    await tx`select set_config('statement_timeout','120s',true)`;
    await tx`insert into public.notification_events
      (organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
       subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
       semantic_sha256)
      select ${options.organizationId}::uuid,'join.requested',1,
        (${revisions}::text[])[1+((n-1)%${revisions.length})],
        'membership.join','join_request',${RAW_REQUEST_ID}::uuid,
        'bulk-revision-1',${options.dedupePrefix}||'-source-'||n::text,
        ${options.occurredAt ?? FIXED_OCCURRED_AT}::timestamptz,
        ${options.dedupePrefix}||'-'||lpad(n::text,6,'0'),${RAW_PAYLOAD},${RAW_PAYLOAD_SHA256},
        repeat('b',64)
      from generate_series(1,${options.count}) n`;
  });
}

export async function withOutboxFixtureMaintenance<T>(
  harness: NotificationOutboxHarness,
  fn: (tx: TransactionSql) => Promise<T>,
) {
  return harness.owner.begin(async (tx) => {
    await tx.unsafe(`ALTER TABLE public.notification_outbox NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.notification_outbox DISABLE TRIGGER notification_outbox_transition;`);
    try {
      return await fn(tx);
    } finally {
      await tx.unsafe(`ALTER TABLE public.notification_outbox ENABLE TRIGGER notification_outbox_transition;
        ALTER TABLE public.notification_outbox FORCE ROW LEVEL SECURITY;`);
    }
  });
}

export async function expireProcessingEvent(harness: NotificationOutboxHarness, eventId: string) {
  await withOutboxFixtureMaintenance(harness, async (tx) => {
    await tx`with stamp as materialized (select clock_timestamp() as value)
      update public.notification_outbox set
        claimed_at=stamp.value-interval '40 seconds',
        hard_deadline=stamp.value+interval '20 seconds',
        lease_expires_at=stamp.value-interval '10 seconds'
      from stamp where event_id=${eventId}::uuid and state='processing'`;
  });
}

export async function currentConnectionState(client: PgClient) {
  const [row] = await client<
    {
      role: string;
      organizationId: string;
      ownerId: string;
      generation: string;
      statementTimeout: string;
      lockTimeout: string;
      idleTimeout: string;
    }[]
  >`select current_user as role,
    current_setting('app.current_org_id',true) as "organizationId",
    current_setting('app.notification_owner',true) as "ownerId",
    current_setting('app.notification_generation',true) as generation,
    current_setting('statement_timeout') as "statementTimeout",
    current_setting('lock_timeout') as "lockTimeout",
    current_setting('idle_in_transaction_session_timeout') as "idleTimeout"`;
  if (!row) throw new Error('Notification worker connection state is unavailable');
  return row;
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Plans?: PlanNode[];
};

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

export function assertBoundedIndexPlan(
  explain: unknown,
  expectedIndex: string,
  maximumExamined = 5_000,
) {
  const root = (explain as Array<{ Plan: PlanNode }>)[0]?.Plan;
  if (!root) throw new Error('Notification EXPLAIN plan is missing');
  const nodes = planNodes(root);
  if (nodes.some((node) => node['Node Type'] === 'Seq Scan')) {
    throw new Error('Notification query used a sequential scan');
  }
  if (nodes.some((node) => node['Node Type'] === 'Sort')) {
    throw new Error('Notification query sorted its eligible population');
  }
  const scans = nodes.filter((node) => node['Index Name'] === expectedIndex);
  if (scans.length === 0) throw new Error(`Notification query did not use ${expectedIndex}`);
  const examined = scans.reduce(
    (sum, scan) =>
      sum +
      ((scan['Actual Rows'] ?? 0) +
        (scan['Rows Removed by Filter'] ?? 0) +
        (scan['Rows Removed by Index Recheck'] ?? 0)) *
        (scan['Actual Loops'] ?? 1),
    0,
  );
  if (examined > maximumExamined) {
    throw new Error(`Notification query examined ${examined} candidate tuples`);
  }
  return { nodes, examined };
}
