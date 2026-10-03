import type postgres from "postgres";
import { expect } from "vitest";
import { withCoordinator } from "$server/services/notifications/scheduler/transaction";
import { OUTBOX_ORG_A, OUTBOX_ORG_B } from "../notification-outbox/postgres-harness";
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  insertRawEvent,
} from "../notification-outbox/runtime-harness";
import type { NotificationSchedulerHarness } from "./postgres-harness";
import { SCHEDULER_OWNER_A, SCHEDULER_OWNER_B, acquireSchedulerRuntime } from "./runtime-cases";

async function rejectedMessage(operation: PromiseLike<unknown>) {
  return operation.then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

async function asHealthReader<T>(
  harness: NotificationSchedulerHarness,
  operation: (tx: postgres.TransactionSql) => PromiseLike<T>,
) {
  return harness.worker.begin(async (tx) => {
    await tx`select set_config('role','notification_health_reader',true),
      set_config('app.current_org_id',${OUTBOX_ORG_A},true)`;
    return operation(tx);
  });
}

type ColumnGrant = { grantee: string; table: string; column: string; privilege: string };
const CONTROL_COLUMNS = [
  "organization_id",
  "state",
  "generation",
  "owner_id",
  "claimed_at",
  "lease_expires_at",
  "hard_deadline",
  "renewal_count",
  "next_due_at",
  "failure_streak",
  "last_failure_code",
  "last_result",
  "last_completed_at",
  "last_success_at",
] as const;
const CURSOR_COLUMNS = [
  "singleton",
  "schema_version",
  "pending_after_org",
  "processing_after_org",
  "next_state",
  "tick_generation",
] as const;
const RUNTIME_COLUMNS = [
  "singleton",
  "schema_version",
  "generation",
  "owner_id",
  "lease_expires_at",
  "last_heartbeat_at",
  "started_at",
  "stopped_at",
  "build_sha",
  "catalog_revision",
  "catalog_sha256",
  "projector_revision",
  "projector_sha256",
  "admission_generation",
  "admission_owner_id",
  "admission_checked_at",
  "admission_code",
  "admission_build_sha",
  "admission_artifact_sha256",
  "admission_catalog_revision",
  "admission_catalog_sha256",
  "admission_projector_revision",
  "admission_projector_sha256",
] as const;

function grants(
  grantee: string,
  table: string,
  columns: readonly string[],
  privilege: string,
): ColumnGrant[] {
  return columns.map((column) => ({ grantee, table, column, privilege }));
}

function sortedGrants(values: readonly ColumnGrant[]) {
  return [...values].sort((left, right) =>
    `${left.grantee}:${left.table}:${left.column}:${left.privilege}`.localeCompare(
      `${right.grantee}:${right.table}:${right.column}:${right.privilege}`,
    ),
  );
}

async function verifyExactColumnGrants(harness: NotificationSchedulerHarness) {
  const actual = await harness.owner<ColumnGrant[]>`
    select grantee,table_name as table,column_name as column,privilege_type as privilege
    from information_schema.column_privileges
    where table_schema='public' and grantee in ('notification_coordinator','notification_health_reader')
      and table_name in ('notification_org_control','notification_scheduler_cursor',
        'notification_worker_runtime','notification_outbox','notification_events')`;
  const expected = [
    ...grants("notification_coordinator", "notification_org_control", CONTROL_COLUMNS, "INSERT"),
    ...grants("notification_coordinator", "notification_org_control", CONTROL_COLUMNS, "SELECT"),
    ...grants(
      "notification_coordinator",
      "notification_org_control",
      CONTROL_COLUMNS.filter((column) => column !== "organization_id"),
      "UPDATE",
    ),
    ...grants(
      "notification_coordinator",
      "notification_scheduler_cursor",
      CURSOR_COLUMNS,
      "SELECT",
    ),
    ...grants(
      "notification_coordinator",
      "notification_scheduler_cursor",
      ["pending_after_org", "processing_after_org", "next_state", "tick_generation"],
      "UPDATE",
    ),
    ...grants("notification_coordinator", "notification_worker_runtime", RUNTIME_COLUMNS, "SELECT"),
    ...grants(
      "notification_coordinator",
      "notification_worker_runtime",
      RUNTIME_COLUMNS.filter((column) => !["singleton", "schema_version"].includes(column)),
      "UPDATE",
    ),
    ...grants(
      "notification_coordinator",
      "notification_outbox",
      ["organization_id", "state", "catalog_revision", "lease_expires_at"],
      "SELECT",
    ),
    ...grants(
      "notification_health_reader",
      "notification_outbox",
      ["organization_id", "state", "catalog_revision", "enqueued_at", "event_id"],
      "SELECT",
    ),
    ...grants(
      "notification_health_reader",
      "notification_org_control",
      [
        "organization_id",
        "state",
        "next_due_at",
        "failure_streak",
        "last_failure_code",
        "last_result",
        "last_completed_at",
        "last_success_at",
      ],
      "SELECT",
    ),
    ...grants(
      "notification_health_reader",
      "notification_worker_runtime",
      RUNTIME_COLUMNS.filter((column) => column !== "admission_owner_id"),
      "SELECT",
    ),
  ];
  expect(sortedGrants(actual)).toEqual(sortedGrants(expected));
  expect(
    await harness.owner`
      select grantee,routine_name as routine,privilege_type as privilege
      from information_schema.routine_privileges
      where specific_schema='public'
        and grantee in ('notification_coordinator','notification_health_reader')
        and routine_name like 'notification_%' order by grantee,routine_name,privilege_type`,
  ).toEqual([
    {
      grantee: "notification_coordinator",
      routine: "notification_scheduler_fence",
      privilege: "EXECUTE",
    },
  ]);
}

export async function verifySchedulerAuthorityBoundary(harness: NotificationSchedulerHarness) {
  await verifyExactColumnGrants(harness);
  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: "scheduler-authority-a" }),
  );
  await asApplicationRole(harness.source, OUTBOX_ORG_B, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_B, dedupeKey: "scheduler-authority-b" }),
  );

  expect(
    await harness.owner<
      { role: string; coordinator: boolean; health: boolean; worker: boolean }[]
    >`select rolname as role,
      pg_has_role(oid,'notification_coordinator','MEMBER') as coordinator,
      pg_has_role(oid,'notification_health_reader','MEMBER') as health,
      pg_has_role(oid,'notification_worker','MEMBER') as worker
      from pg_roles where rolname in ('anon','authenticated','service_role','app_assistant_ro',
        'app_ledger','notification_event_trigger','notification_worker') order by rolname`,
  ).toEqual([
    { role: "anon", coordinator: false, health: false, worker: false },
    { role: "app_assistant_ro", coordinator: false, health: false, worker: false },
    { role: "app_ledger", coordinator: false, health: false, worker: false },
    { role: "authenticated", coordinator: false, health: false, worker: false },
    { role: "notification_event_trigger", coordinator: false, health: false, worker: false },
    { role: "notification_worker", coordinator: false, health: false, worker: true },
    { role: "service_role", coordinator: false, health: false, worker: false },
  ]);

  await asHealthReader(harness, async (tx) => {
    expect(
      await tx`select organization_id::text,state,catalog_revision from public.notification_outbox
        order by organization_id`,
    ).toEqual([
      {
        organization_id: OUTBOX_ORG_A,
        state: "pending",
        catalog_revision: CURRENT_CATALOG_REVISION,
      },
    ]);
  });
  expect(
    await rejectedMessage(
      asHealthReader(harness, (tx) => tx`select payload_canonical from public.notification_events`),
    ),
  ).toMatch(/permission denied/);
  expect(
    await rejectedMessage(
      asHealthReader(harness, (tx) => tx`select lease_owner from public.notification_outbox`),
    ),
  ).toMatch(/permission denied/);
  expect(
    await rejectedMessage(
      asHealthReader(
        harness,
        (tx) => tx`select pending_after_org from public.notification_scheduler_cursor`,
      ),
    ),
  ).toMatch(/permission denied/);
  expect(
    await rejectedMessage(
      asHealthReader(
        harness,
        (tx) => tx`update public.notification_org_control set next_due_at=clock_timestamp()`,
      ),
    ),
  ).toMatch(/permission denied/);

  const runtime = await acquireSchedulerRuntime();
  await expect(
    withCoordinator(
      SCHEDULER_OWNER_B,
      runtime.generation,
      (tx) =>
        tx`update public.notification_scheduler_cursor set next_state='processing' where singleton`,
    ),
  ).rejects.toThrow(/forbidden|lease|fence/i);
  await expect(
    withCoordinator(
      SCHEDULER_OWNER_A,
      String(Number(runtime.generation) + 1),
      (tx) =>
        tx`update public.notification_scheduler_cursor set next_state='processing' where singleton`,
    ),
  ).rejects.toThrow(/forbidden|lease|fence/i);
  await expect(
    withCoordinator(
      runtime.ownerId,
      runtime.generation,
      (tx) =>
        tx`update public.notification_worker_runtime set generation=generation+1 where singleton`,
    ),
  ).rejects.toThrow(/invalid|stale/i);
}
