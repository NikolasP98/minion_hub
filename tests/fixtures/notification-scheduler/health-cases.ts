import { createHash } from "node:crypto";
import { expect } from "vitest";
import { notificationCatalogManifest } from "$lib/notifications/catalog-manifest";
import { readNotificationWorkerHealth } from "$server/services/notifications/worker-health";
import { NotificationWorkerUnavailable } from "$server/services/notifications/worker-failure";
import { OUTBOX_ORG_A, OUTBOX_ORG_B, OUTBOX_ORG_C } from "../notification-outbox/postgres-harness";
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  deferred,
  insertRawEvent,
} from "../notification-outbox/runtime-harness";
import type { NotificationSchedulerHarness } from "./postgres-harness";
import { acquireSchedulerRuntime, schedulerIdentity } from "./runtime-cases";

async function connectionState(harness: NotificationSchedulerHarness) {
  const [row] = await harness.worker<
    {
      role: string;
      organizationId: string;
      runtimeOwner: string;
      runtimeGeneration: string;
      statementTimeout: string;
      lockTimeout: string;
      idleTimeout: string;
    }[]
  >`select current_user as role,current_setting('app.current_org_id',true) as "organizationId",
    current_setting('app.notification_runtime_owner',true) as "runtimeOwner",
    current_setting('app.notification_runtime_generation',true) as "runtimeGeneration",
    current_setting('statement_timeout') as "statementTimeout",
    current_setting('lock_timeout') as "lockTimeout",
    current_setting('idle_in_transaction_session_timeout') as "idleTimeout"`;
  return row;
}

const RESTORED = {
  role: "minion_qc",
  organizationId: "",
  runtimeOwner: "",
  runtimeGeneration: "",
  statementTimeout: "30s",
  lockTimeout: "0",
  idleTimeout: "0",
};

export async function verifyHealthIsolationAndRestoration(harness: NotificationSchedulerHarness) {
  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: "scheduler-health-a" }),
  );
  await asApplicationRole(harness.source, OUTBOX_ORG_B, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_B, dedupeKey: "scheduler-health-b" }),
  );
  await acquireSchedulerRuntime(
    schedulerIdentity(undefined, {
      catalogSha256: createHash("sha256").update(notificationCatalogManifest()).digest("hex"),
    }),
  );

  const health = await readNotificationWorkerHealth(OUTBOX_ORG_A);
  expect(health.state).toBe("runnable");
  expect(health.queue).toMatchObject({
    pending: { count: 1, lowerBound: false },
    processing: { count: 0, lowerBound: false },
    unsupportedCatalogPending: false,
  });
  expect((await readNotificationWorkerHealth(OUTBOX_ORG_C)).queue.pending.count).toBe(0);
  expect(await connectionState(harness)).toEqual(RESTORED);

  const locked = deferred();
  const release = deferred();
  const holder = harness.competitor.begin(async (tx) => {
    await tx`lock table public.notification_worker_runtime in access exclusive mode`;
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  try {
    const failure = await readNotificationWorkerHealth(OUTBOX_ORG_A).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(NotificationWorkerUnavailable);
    expect(failure).toMatchObject({
      code: "notification_worker_unavailable",
      reason: "lock_timeout",
    });
  } finally {
    release.resolve();
    await holder;
  }
  expect(await connectionState(harness)).toEqual(RESTORED);

  expect(health.worker.identity?.catalogRevision).toBe(CURRENT_CATALOG_REVISION);
}
