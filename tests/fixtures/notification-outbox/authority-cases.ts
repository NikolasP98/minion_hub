import type { Mock } from 'vitest';
import { expect } from 'vitest';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
} from '$server/services/notifications/worker-transaction';
import {
  CURRENT_CATALOG_REVISION,
  RAW_PAYLOAD,
  asApplicationRole,
  currentConnectionState,
  fixtureUuid,
  insertRawEvent,
} from './runtime-harness';
import {
  OUTBOX_ORG_A,
  OUTBOX_ORG_B,
  OUTBOX_OWNER_A,
  type NotificationOutboxHarness,
} from './postgres-harness';

type WorkerPoolBoundary = Readonly<{
  rlsPool: Mock;
  ordinaryPool: Mock;
  criticalPool: Mock;
}>;

export async function verifyNotificationAuthority(harness: NotificationOutboxHarness) {
  const eventId = await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: 'authority-one' }),
  );
  const roles = ['anon', 'authenticated', 'service_role', 'app_assistant_ro'];
  for (const role of roles) {
    await expect(
      harness.competitor.begin(async (tx) => {
        await tx.unsafe(`set local role "${role}"`);
        await tx`select id from public.notification_events`;
      }),
    ).rejects.toThrow();
  }
  expect(
    await harness.source.begin(async (tx) => {
      await tx`select set_config('role','app_ledger',true)`;
      return tx`select id from public.notification_events`;
    }),
  ).toEqual([]);
  expect(
    await harness.source.begin(async (tx) => {
      await tx`select set_config('role','app_ledger',true),
        set_config('app.current_org_id','not-a-uuid',true)`;
      return tx`select id from public.notification_events`;
    }),
  ).toEqual([]);
  expect(
    await withNotificationWorkerTransaction(
      { ownerId: OUTBOX_OWNER_A, organizationId: OUTBOX_ORG_B },
      (tx) => tx`select id from public.notification_events`,
    ),
  ).toEqual([]);

  await expect(
    asApplicationRole(
      harness.source,
      OUTBOX_ORG_A,
      (tx) =>
        tx`insert into public.notification_outbox(event_id,organization_id,catalog_revision,state)
        values (${fixtureUuid(999, 8)}::uuid,${OUTBOX_ORG_A}::uuid,
          ${CURRENT_CATALOG_REVISION},'projected')`,
    ),
  ).rejects.toThrow();
  await expect(
    asApplicationRole(
      harness.source,
      OUTBOX_ORG_A,
      (tx) =>
        tx`update public.notification_events set subject_revision='changed'
          where id=${eventId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    asApplicationRole(
      harness.source,
      OUTBOX_ORG_A,
      (tx) => tx`select public.notification_event_enqueue()`,
    ),
  ).rejects.toThrow();
  await expect(
    withNotificationWorkerTransaction(
      { ownerId: OUTBOX_OWNER_A, organizationId: OUTBOX_ORG_A },
      (tx) => tx`delete from public.notification_outbox where event_id=${eventId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    withNotificationWorkerTransaction(
      { ownerId: OUTBOX_OWNER_A, organizationId: OUTBOX_ORG_A },
      (tx) =>
        tx`insert into public.notification_events
        (organization_id,kind,schema_version,catalog_revision,producer_id,subject_type,subject_id,
         subject_revision,source_identity,occurred_at,dedupe_key,payload_canonical,payload_sha256,
         semantic_sha256)
        values (${OUTBOX_ORG_A}::uuid,'join.requested',1,${CURRENT_CATALOG_REVISION},
          'membership.join','join_request',${fixtureUuid(1)}::uuid,'r1','s1',clock_timestamp(),
          'worker-forged',${RAW_PAYLOAD},repeat('a',64),repeat('b',64))`,
    ),
  ).rejects.toThrow();

  await harness.owner`create table public.notification_forged_source(id uuid)`;
  try {
    await harness.owner.unsafe(`create trigger notification_forged_enqueue after insert
      on public.notification_forged_source for each row
      execute function public.notification_event_enqueue()`);
    await expect(
      harness.owner`insert into public.notification_forged_source(id)
        values (${fixtureUuid(2, 8)}::uuid)`,
    ).rejects.toThrow();
  } finally {
    await harness.owner`drop table public.notification_forged_source`;
  }

  const graph = await harness.owner<
    { role: string; workerMember: boolean; triggerMember: boolean }[]
  >`select rolname as role,
    pg_has_role(rolname,'notification_worker','MEMBER') as "workerMember",
    pg_has_role(rolname,'notification_event_trigger','MEMBER') as "triggerMember"
    from pg_roles where rolname=any(${[
      'app_ledger',
      'anon',
      'authenticated',
      'service_role',
      'app_assistant_ro',
    ]}) order by rolname`;
  expect(graph.every((row) => !row.workerMember && !row.triggerMember)).toBe(true);
  const [ownerShape] = await harness.owner<
    { triggerOwnsEvent: boolean; triggerOwnsOutbox: boolean; triggerBypass: boolean }[]
  >`select
    pg_get_userbyid((select relowner from pg_class where oid='public.notification_events'::regclass))
      ='notification_event_trigger' as "triggerOwnsEvent",
    pg_get_userbyid((select relowner from pg_class where oid='public.notification_outbox'::regclass))
      ='notification_event_trigger' as "triggerOwnsOutbox",
    (select rolbypassrls from pg_roles where rolname='notification_event_trigger')
      as "triggerBypass"`;
  expect(ownerShape).toEqual({
    triggerOwnsEvent: false,
    triggerOwnsOutbox: false,
    triggerBypass: false,
  });
  const hiddenGrants = await harness.owner<
    { grants: number }[]
  >`select count(*)::int as grants from information_schema.column_privileges
    where table_schema='public' and table_name in ('notification_events','notification_outbox')
      and grantee in ('anon','authenticated','service_role','app_assistant_ro','app_ledger')
      and not (grantee='app_ledger' and table_name='notification_events')`;
  expect(hiddenGrants).toEqual([{ grants: 0 }]);
}

export async function verifyNotificationWorkerPool(
  harness: NotificationOutboxHarness,
  boundary: WorkerPoolBoundary,
  workerScope: NotificationWorkerScope,
) {
  boundary.rlsPool.mockImplementation(() => harness.serialWorker);
  // PostgreSQL retains an empty custom-GUC placeholder after the first SET LOCAL rollback.
  // Warm the reusable connection before taking the exact clean baseline.
  await withNotificationWorkerTransaction(workerScope, async () => undefined);
  const before = await currentConnectionState(harness.serialWorker);
  const during = await withNotificationWorkerTransaction(workerScope, async (tx) => {
    const [row] = await tx<
      {
        role: string;
        org: string;
        owner: string;
        statementTimeout: string;
        lockTimeout: string;
        idleTimeout: string;
      }[]
    >`select current_user as role,current_setting('app.current_org_id',true) as org,
      current_setting('app.notification_owner',true) as owner,
      current_setting('statement_timeout') as "statementTimeout",
      current_setting('lock_timeout') as "lockTimeout",
      current_setting('idle_in_transaction_session_timeout') as "idleTimeout"`;
    return row;
  });
  expect(during).toEqual({
    role: 'notification_worker',
    org: workerScope.organizationId,
    owner: workerScope.ownerId,
    statementTimeout: '3s',
    lockTimeout: '250ms',
    idleTimeout: '5s',
  });
  expect(await currentConnectionState(harness.serialWorker)).toEqual(before);

  await expect(
    withNotificationWorkerTransaction(workerScope, async () => {
      throw new Error('fixture callback failed');
    }),
  ).rejects.toThrow('fixture callback failed');
  expect(await currentConnectionState(harness.serialWorker)).toEqual(before);

  await expect(
    withNotificationWorkerTransaction(workerScope, (tx) => tx.unsafe('select pg_sleep(3.2)')),
  ).rejects.toMatchObject({
    code: 'notification_worker_unavailable',
    reason: 'statement_timeout',
  });
  expect(await currentConnectionState(harness.serialWorker)).toEqual(before);
  expect(boundary.ordinaryPool).not.toHaveBeenCalled();
  expect(boundary.criticalPool).not.toHaveBeenCalled();
}
