import { createHash } from 'node:crypto';
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
  restoreSupportedBaseline,
  runMigration,
  runMigrationStatus,
  setupNotificationMigrationHarness,
  teardownNotificationMigrationHarness,
  type Sql,
} from '../notification-migrations/reconciliation-harness';

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
  let worker: Sql | undefined;
  let competitor: Sql | undefined;
  const workerQueries: CapturedQuery[] = [];
  try {
    await restoreSupportedBaseline(child);
    const migration = runMigration(child.url);
    expect(migration.error).toBeUndefined();
    expect(migration.signal).toBeNull();
    expect(migration.code, migration.stderr.slice(-8_000)).toBe(0);
    expect(migration.stdout).toContain('db:migrate — applying 20261003170000');
    const status = runMigrationStatus(child.url);
    expect(status.error).toBeUndefined();
    expect(status.signal).toBeNull();
    expect(status.status, status.stderr.slice(-4_000)).toBe(0);
    expect(status.stdout).toContain('0 pending');
    expect(
      await child.db`select version from public.hub_migrations
        where version in ('20261003150000','20261003160000','20261003170000') order by version`,
    ).toEqual([
      { version: '20261003150000' },
      { version: '20261003160000' },
      { version: '20261003170000' },
    ]);
    // One physical worker connection makes transaction-local scope cleanup and pool reuse
    // observable instead of probabilistic. Independent races use the competitor client.
    worker = client(child.url, 'notification-slice5-worker', 1, workerQueries);
    competitor = client(child.url, 'notification-slice5-competitor', 2);
    return Object.freeze({
      child,
      owner: child.db,
      worker,
      competitor,
      workerQueries,
      rolesBefore,
    });
  } catch (error) {
    await worker?.end({ timeout: 5 }).catch(() => undefined);
    await competitor?.end({ timeout: 5 }).catch(() => undefined);
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
}

export async function teardownNotificationAudienceHarness(
  harness: NotificationAudienceHarness,
): Promise<void> {
  await Promise.all([harness.worker.end({ timeout: 5 }), harness.competitor.end({ timeout: 5 })]);
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
