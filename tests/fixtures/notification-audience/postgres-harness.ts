import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { expect } from 'vitest';
import {
  NOTIFICATION_PROJECTION_REVISION,
  notificationProjectionManifest,
} from '../../../src/lib/notifications/projection-manifest';
import {
  createChild,
  dropChild,
  fixtureRolesCreated,
  harness as migrationHarness,
  MIGRATIONS,
  restoreSupportedBaseline,
  runMigration,
  runMigrationStatus,
  setupNotificationMigrationHarness,
  teardownNotificationMigrationHarness,
  type Sql,
} from '../notification-migrations/reconciliation-harness';

const FENCE_ONCE_VERSION = '20261007120000';
const FENCE_ONCE_SOURCE = readFileSync(
  join(MIGRATIONS, `${FENCE_ONCE_VERSION}_notification_projection_fence_once.sql`),
  'utf8',
);

async function verifyAuthBoundaryRollbacks(
  child: Awaited<ReturnType<typeof createChild>>,
): Promise<void> {
  const mutations = [
    [
      `create function auth.extra_public() returns boolean language sql as 'select true'`,
      'Notification projection auth',
    ],
    [`alter function auth.uid() security definer`, 'Notification projection auth'],
    [`revoke execute on function auth.uid() from dashboard_user`, 'Notification projection auth'],
    [`alter function auth.uid() owner to postgres`, 'Notification projection auth'],
    [`grant select on auth.users to app_notification_worker`, 'Notification projection auth'],
    [`grant app_ledger to app_notification_worker`, 'Notification projection auth'],
    [`grant usage on schema auth to app_notification_worker`, 'Notification projection auth'],
    [
      `create or replace function auth.uid() returns uuid language sql stable as
      'select gen_random_uuid()'`,
      'cleared JWT identity changed',
    ],
  ] as const;
  const admin = postgres(child.adminUrl.href, { max: 1, prepare: false });
  try {
    for (const [mutation, reason] of mutations) {
      let failure: unknown;
      try {
        await admin.begin(async (tx) => {
          await tx.unsafe(mutation);
          await tx.unsafe(`set local role ${child.url.username}`);
          await tx.unsafe(FENCE_ONCE_SOURCE);
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(reason);
      expect(
        await child.db<{ usage: boolean }[]>`
          select has_schema_privilege('app_notification_worker','auth','USAGE') as usage`,
      ).toEqual([{ usage: false }]);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const MIGRATION_ROLES = [
  'notification_event_trigger',
  'notification_worker',
  'notification_coordinator',
  'notification_health_reader',
  'app_notification_worker',
  'notification_projection_finalizer',
] as const;

export const AUDIENCE_RUNTIME_OWNER = '71000000-0000-4000-8000-000000000001';
export const AUDIENCE_BUILD_SHA = 'a'.repeat(40);
export const AUDIENCE_CATALOG_SHA = 'b'.repeat(64);
export const AUDIENCE_PROJECTOR_SHA = createHash('sha256')
  .update(notificationProjectionManifest())
  .digest('hex');

export type NotificationAudienceHarness = Readonly<{
  child: Awaited<ReturnType<typeof createChild>>;
  owner: Sql;
  worker: Sql;
  competitor: Sql;
  workerQueries: CapturedQuery[];
  rolesBefore: ReadonlySet<string>;
}>;

export type FixtureSqlParameter = postgres.ParameterOrJSON<never>;

export type CapturedQuery = Readonly<{
  sql: string;
  parameters: readonly FixtureSqlParameter[];
}>;

function client(url: URL, name: string, max = 1, queries?: CapturedQuery[]): Sql {
  return postgres(url.href, {
    max,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 3,
    idle_timeout: 10,
    connection: {
      application_name: name,
      statement_timeout: 30_000,
    },
    debug: queries
      ? (_connection, sql, parameters) => {
          queries.push(Object.freeze({ sql, parameters: Object.freeze([...parameters]) }));
        }
      : undefined,
  });
}

async function currentMigrationRoles(): Promise<Set<string>> {
  const rows = await migrationHarness.owner<{ rolname: string }[]>`
    select rolname from pg_roles where rolname=any(${[...MIGRATION_ROLES]})`;
  return new Set(rows.map((row) => row.rolname));
}

export async function setupNotificationAudienceHarness(): Promise<NotificationAudienceHarness> {
  await setupNotificationMigrationHarness();
  const rolesBefore = await currentMigrationRoles();
  const child = await createChild('audience-projection');
  let owner: Sql | undefined;
  let worker: Sql | undefined;
  let competitor: Sql | undefined;
  const workerQueries: CapturedQuery[] = [];
  try {
    await restoreSupportedBaseline(child);
    await child.db`insert into public.hub_migrations(version) values (${FENCE_ONCE_VERSION})`;
    const predecessor = runMigration(child.url);
    expect(predecessor.code, predecessor.stderr.slice(-8_000)).toBe(0);
    expect(predecessor.stdout).toContain('db:migrate — applying 20261003170000');
    await child.db`delete from public.hub_migrations where version=${FENCE_ONCE_VERSION}`;
    await verifyAuthBoundaryRollbacks(child);
    const migration = runMigration(child.url);
    expect(migration.error).toBeUndefined();
    expect(migration.signal).toBeNull();
    expect(migration.code, migration.stderr.slice(-8_000)).toBe(0);
    expect(migration.stdout).toContain('db:migrate — applying 20261007120000');
    const status = runMigrationStatus(child.url);
    expect(status.error).toBeUndefined();
    expect(status.signal).toBeNull();
    expect(status.status, status.stderr.slice(-4_000)).toBe(0);
    expect(status.stdout).toContain('0 pending');
    expect(
      await child.db`select version from public.hub_migrations
        where version in ('20261003150000','20261003160000','20261003170000','20261007120000')
        order by version`,
    ).toEqual([
      { version: '20261003150000' },
      { version: '20261003160000' },
      { version: '20261003170000' },
      { version: '20261007120000' },
    ]);
    owner = client(child.adminUrl, 'notification-slice5-owner');
    // One physical worker connection makes transaction-local scope cleanup and pool reuse
    // observable instead of probabilistic. Independent races use the competitor client.
    worker = client(child.url, 'notification-slice5-worker', 1, workerQueries);
    competitor = client(child.url, 'notification-slice5-competitor', 2);
    return Object.freeze({
      child,
      owner,
      worker,
      competitor,
      workerQueries,
      rolesBefore,
    });
  } catch (error) {
    await worker?.end({ timeout: 5 }).catch(() => undefined);
    await competitor?.end({ timeout: 5 }).catch(() => undefined);
    await owner?.end({ timeout: 5 }).catch(() => undefined);
    for (const role of await currentMigrationRoles()) {
      if (!rolesBefore.has(role)) fixtureRolesCreated.add(role);
    }
    await dropChild(child).catch(() => undefined);
    await teardownNotificationMigrationHarness().catch(() => undefined);
    throw error;
  }
}

export async function resetNotificationAudienceOperationalState(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await harness.owner.unsafe(`
    alter table public.notification_worker_runtime disable trigger notification_runtime_transition;
    alter table public.notification_org_control disable trigger notification_control_transition;
    update public.notification_worker_runtime set owner_id=null,lease_expires_at=null,
      stopped_at=clock_timestamp() where singleton;
    update public.notification_org_control set state='idle',owner_id=null,claimed_at=null,
      lease_expires_at=null,hard_deadline=null,renewal_count=null,
      next_due_at=clock_timestamp()+interval '1 day' where state='running';
    update public.notification_org_control set next_due_at=clock_timestamp()+interval '1 day'
      where state='idle';
    alter table public.notification_org_control enable trigger notification_control_transition;
    alter table public.notification_worker_runtime enable trigger notification_runtime_transition;
  `);
  // Keep planner statistics current so every case runs the plan production (always analyzed)
  // would run, instead of depending on whether autovacuum visited the child database yet.
  // Before migration 20261007120000 fresh statistics exposed NOTIF-019: every source policy from
  // 20261003170000 called the VOLATILE notification_projection_source_fence() per visited row, so
  // the 10,001-member authority query overran its 10s budget once large organizations existed.
  // The lane keeps ANALYZE so a regression to per-row fence evaluation fails here again.
  await harness.owner`analyze`;
}

export async function teardownNotificationAudienceHarness(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await Promise.all([
    harness.owner.end({ timeout: 5 }),
    harness.worker.end({ timeout: 5 }),
    harness.competitor.end({ timeout: 5 }),
  ]);
  for (const role of await currentMigrationRoles()) {
    if (!harness.rolesBefore.has(role)) fixtureRolesCreated.add(role);
  }
  await dropChild(harness.child);
  await teardownNotificationMigrationHarness();
}

export function audienceRuntimeIdentity() {
  return Object.freeze({
    ownerId: AUDIENCE_RUNTIME_OWNER,
    buildSha: AUDIENCE_BUILD_SHA,
    catalogRevision: '2026-10-03.1',
    catalogSha256: AUDIENCE_CATALOG_SHA,
    projectorRevision: NOTIFICATION_PROJECTION_REVISION,
    projectorSha256: AUDIENCE_PROJECTOR_SHA,
  });
}
