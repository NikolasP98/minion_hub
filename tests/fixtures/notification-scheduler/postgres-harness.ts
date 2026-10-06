import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UUID_PATTERN } from '../../../src/lib/notifications/fields';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import {
  setupNotificationOutboxHarness,
  type CommandResult,
  type NotificationOutboxHarness,
} from '../notification-outbox/postgres-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEDULER_VERSION = '20261003160000';
const SCHEDULER_ROLES = ['notification_coordinator', 'notification_health_reader'] as const;
const OUTBOX_ROLES = ['notification_event_trigger', 'notification_worker'] as const;

export type NotificationSchedulerHarness = NotificationOutboxHarness &
  Readonly<{
    fixtureOwnerId: string;
    schedulerMigration: CommandResult;
    schedulerRerun: CommandResult;
    schedulerStatus: CommandResult;
  }>;

function quoteChildDatabase(value: string) {
  if (!/^minion_qc_notification_outbox_[a-f0-9]{20}$/.test(value)) {
    throw new Error('Invalid notification scheduler child database identifier');
  }
  return `"${value}"`;
}

function command(url: URL, script: 'db-migrate.ts' | 'db-status.ts'): CommandResult {
  const result = spawnSync('bun', [join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    env: {
      ...process.env,
      SUPABASE_DB_URL: url.href,
      FORCE_DB_MIGRATE: '1',
      VERCEL_ENV: 'test',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return Object.freeze({
    code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  });
}

async function assertSchedulerRolesAbsent() {
  const parent = await openDisposablePostgres();
  try {
    const roles = await parent.owner<{ rolname: string }[]>`
      select rolname from pg_roles where rolname=any(${[...SCHEDULER_ROLES]}) order by rolname`;
    if (roles.length) throw new Error('Notification scheduler fixture roles must be absent');
  } finally {
    await parent.close();
  }
}

async function closeHarnessConnections(harness: NotificationOutboxHarness) {
  await Promise.allSettled([
    harness.owner.end({ timeout: 5 }),
    harness.source.end({ timeout: 5 }),
    harness.worker.end({ timeout: 5 }),
    harness.serialWorker.end({ timeout: 5 }),
    harness.competitor.end({ timeout: 5 }),
  ]);
}

/**
 * The isolated Slice4 fixture intentionally runs only migrations 150000 and 160000. Apply the
 * exact Slice5 routing-column/index/grant delta that production migration 170000 owns so current
 * discovery SQL is qualified without pretending this minimal schema can qualify all Slice5 source
 * relations. The full production runner is exercised by the audience-projection native fixture.
 */
async function installProjectionRoutingCompatibility(harness: NotificationOutboxHarness) {
  await harness.owner.unsafe(`
    alter table public.notification_outbox add column kind text;
    alter table public.notification_outbox add column schema_version integer;
    update public.notification_outbox o set kind=e.kind,schema_version=e.schema_version
      from public.notification_events e
      where e.organization_id=o.organization_id and e.id=o.event_id
        and e.catalog_revision=o.catalog_revision;
    alter table public.notification_outbox alter column kind set not null;
    alter table public.notification_outbox alter column schema_version set not null;
    drop index public.notification_pending_claim_idx;
    drop index public.notification_expired_claim_idx;
    create index notification_pending_claim_idx on public.notification_outbox
      (organization_id,catalog_revision collate "C",kind collate "C",schema_version,event_id)
      where state='pending';
    create index notification_expired_claim_idx on public.notification_outbox
      (organization_id,catalog_revision collate "C",kind collate "C",schema_version,
        lease_expires_at,event_id)
      where state='processing';
    grant select(kind,schema_version) on public.notification_outbox to notification_coordinator;
    create or replace function public.notification_event_enqueue() returns trigger
    language plpgsql security definer set search_path='' as $$
    begin
      if tg_relid<>'public.notification_events'::regclass or tg_table_schema<>'public'
        or tg_table_name<>'notification_events' or tg_op<>'INSERT' or tg_when<>'AFTER' then
        raise exception 'Notification enqueue trigger source is invalid';
      end if;
      insert into public.notification_outbox(
        event_id,organization_id,catalog_revision,kind,schema_version)
      values(new.id,new.organization_id,new.catalog_revision,new.kind,new.schema_version);
      return new;
    end $$;
  `);
}

async function dropFixtureRole(
  harness: NotificationOutboxHarness,
  role: (typeof SCHEDULER_ROLES)[number] | (typeof OUTBOX_ROLES)[number],
) {
  await harness.parent.owner.unsafe(`REVOKE ${role} FROM minion_qc`).catch(() => undefined);
  await harness.parent.owner.unsafe(`DROP ROLE IF EXISTS ${role}`);
}

/**
 * Extends the accepted Slice3 child fixture without changing it. The returned URL and owner UUID
 * are the exact inputs for the compiled qualification process.
 */
export async function setupNotificationSchedulerHarness(
  fixtureOwnerId = randomUUID(),
): Promise<NotificationSchedulerHarness> {
  if (!UUID_PATTERN.test(fixtureOwnerId)) {
    throw new Error('Invalid notification scheduler fixture owner');
  }
  await assertSchedulerRolesAbsent();
  const base = await setupNotificationOutboxHarness();
  try {
    await base.parent.owner.unsafe(
      `COMMENT ON DATABASE ${quoteChildDatabase(base.childName)} IS 'minion-notification-scheduler-child:v1:${fixtureOwnerId}'`,
    );
    const removed = await base.owner`
      delete from public.hub_migrations where version=${SCHEDULER_VERSION} returning version`;
    if (removed.length !== 1) {
      throw new Error('Notification scheduler migration was not premarked by the Slice3 fixture');
    }
    const schedulerMigration = command(base.childUrl, 'db-migrate.ts');
    if (schedulerMigration.error || schedulerMigration.signal || schedulerMigration.code !== 0) {
      throw new Error(
        `Notification scheduler migration failed: ${schedulerMigration.stderr.slice(-2000)}`,
      );
    }
    await installProjectionRoutingCompatibility(base);
    const schedulerStatus = command(base.childUrl, 'db-status.ts');
    if (schedulerStatus.error || schedulerStatus.signal || schedulerStatus.code !== 0) {
      throw new Error(
        `Notification scheduler status failed: ${schedulerStatus.stderr.slice(-2000)}`,
      );
    }
    const schedulerRerun = command(base.childUrl, 'db-migrate.ts');
    if (schedulerRerun.error || schedulerRerun.signal || schedulerRerun.code !== 0) {
      throw new Error(
        `Notification scheduler migration rerun failed: ${schedulerRerun.stderr.slice(-2000)}`,
      );
    }
    return Object.freeze({
      ...base,
      fixtureOwnerId,
      schedulerMigration,
      schedulerRerun,
      schedulerStatus,
    });
  } catch (error) {
    await teardownNotificationSchedulerHarness({
      ...base,
      fixtureOwnerId,
      schedulerMigration: Object.freeze({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: undefined,
      }),
      schedulerRerun: Object.freeze({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: undefined,
      }),
      schedulerStatus: Object.freeze({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: undefined,
      }),
    }).catch(() => undefined);
    throw error;
  }
}

export async function resetNotificationSchedulerHarness(
  harness: NotificationSchedulerHarness,
): Promise<void> {
  await harness.owner.unsafe(`
    ALTER TABLE public.notification_worker_runtime DISABLE TRIGGER notification_runtime_transition;
    ALTER TABLE public.notification_scheduler_cursor DISABLE TRIGGER notification_cursor_transition;
    ALTER TABLE public.notification_org_control DISABLE TRIGGER notification_control_transition;
    TRUNCATE TABLE public.notification_org_control,public.notification_outbox,
      public.notification_events,public.notification_source_fixture;
    TRUNCATE TABLE public.notification_scheduler_cursor,public.notification_worker_runtime;
    INSERT INTO public.notification_scheduler_cursor(singleton) VALUES(true);
    INSERT INTO public.notification_worker_runtime(singleton) VALUES(true);
    ALTER TABLE public.notification_org_control ENABLE TRIGGER notification_control_transition;
    ALTER TABLE public.notification_scheduler_cursor ENABLE TRIGGER notification_cursor_transition;
    ALTER TABLE public.notification_worker_runtime ENABLE TRIGGER notification_runtime_transition;
  `);
}

export async function withSchedulerFixtureMaintenance<T>(
  harness: NotificationSchedulerHarness,
  operation: (owner: NotificationSchedulerHarness['owner']) => Promise<T>,
): Promise<T> {
  await harness.owner.unsafe(`
    ALTER TABLE public.notification_worker_runtime DISABLE TRIGGER notification_runtime_transition;
    ALTER TABLE public.notification_scheduler_cursor DISABLE TRIGGER notification_cursor_transition;
    ALTER TABLE public.notification_org_control DISABLE TRIGGER notification_control_transition;
  `);
  try {
    return await operation(harness.owner);
  } finally {
    await harness.owner.unsafe(`
      ALTER TABLE public.notification_org_control ENABLE TRIGGER notification_control_transition;
      ALTER TABLE public.notification_scheduler_cursor ENABLE TRIGGER notification_cursor_transition;
      ALTER TABLE public.notification_worker_runtime ENABLE TRIGGER notification_runtime_transition;
    `);
  }
}

export async function teardownNotificationSchedulerHarness(
  harness: NotificationSchedulerHarness,
): Promise<void> {
  await closeHarnessConnections(harness);
  await harness.parent.owner.unsafe(
    `DROP DATABASE ${quoteChildDatabase(harness.childName)} WITH (FORCE)`,
  );
  for (const role of [...SCHEDULER_ROLES, ...OUTBOX_ROLES]) {
    await dropFixtureRole(harness, role);
  }
  for (const role of [...harness.createdPrerequisiteRoles].reverse()) {
    await harness.parent.owner.unsafe(`DROP ROLE IF EXISTS ${role}`);
  }
  const databases = await harness.parent.owner<{ datname: string }[]>`
    select datname from pg_database where datname=${harness.childName}`;
  const roles = await harness.parent.owner<{ rolname: string }[]>`
    select rolname from pg_roles where rolname=any(${[
      ...SCHEDULER_ROLES,
      ...OUTBOX_ROLES,
      ...harness.createdPrerequisiteRoles,
    ]})`;
  await harness.parent.close();
  if (databases.length || roles.length) {
    throw new Error('Notification scheduler fixture cleanup left a child database or role');
  }
}
