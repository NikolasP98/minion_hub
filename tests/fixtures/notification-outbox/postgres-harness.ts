import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  DISPOSABLE_DATABASE_MARKER,
  openDisposablePostgres,
  validateDisposableDatabaseUrl,
} from '../../../scripts/qc/disposable-postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const CHILD_MARKER = 'minion-notification-outbox-child:v1';
const CHILD_PREFIX = 'minion_qc_notification_outbox_';
const SLICE2_VERSION = '20261003140000';
const SLICE3_VERSION = '20261003150000';
const ROLE_NAMES = ['notification_event_trigger', 'notification_worker'] as const;
const OPTIONAL_PREREQUISITE_ROLES = ['app_assistant_ro', 'service_role'] as const;

export const OUTBOX_ORG_A = '10000000-0000-4000-8000-0000000000a1';
export const OUTBOX_ORG_B = '10000000-0000-4000-8000-0000000000b2';
export const OUTBOX_ORG_C = '10000000-0000-4000-8000-0000000000c3';
export const OUTBOX_OWNER_A = '20000000-0000-4000-8000-0000000000a1';
export const OUTBOX_OWNER_B = '20000000-0000-4000-8000-0000000000b2';

export type PgClient = ReturnType<typeof postgres>;

export type CommandResult = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
}>;

export type NotificationOutboxHarness = Readonly<{
  parent: Awaited<ReturnType<typeof openDisposablePostgres>>;
  childName: string;
  childUrl: URL;
  owner: PgClient;
  source: PgClient;
  worker: PgClient;
  serialWorker: PgClient;
  competitor: PgClient;
  createdPrerequisiteRoles: readonly (typeof OPTIONAL_PREREQUISITE_ROLES)[number][];
  migration: CommandResult;
  rerun: CommandResult;
  status: CommandResult;
}>;

function quoteChildDatabase(value: string) {
  if (!/^minion_qc_notification_outbox_[a-f0-9]{20}$/.test(value)) {
    throw new Error('Invalid notification outbox child database identifier');
  }
  return `"${value}"`;
}

function migrationVersions() {
  return [
    ...new Set(
      readdirSync(MIGRATIONS)
        .filter((file) => file.endsWith('.sql'))
        .map((file) => file.replace(/_.*/, '')),
    ),
  ].sort();
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

async function installPrerequisites(owner: PgClient) {
  const expectedRoles = ['app_ledger', 'app_assistant_ro', 'anon', 'authenticated', 'service_role'];
  const roles = await owner<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname=ANY(${expectedRoles}) ORDER BY rolname`;
  if (
    JSON.stringify(roles.map((row) => row.rolname)) !== JSON.stringify([...expectedRoles].sort())
  ) {
    throw new Error('Notification outbox fixture application roles are unavailable');
  }
  await owner.unsafe(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.sched_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL);
    CREATE TABLE public.hub_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  for (const version of migrationVersions()) {
    if (version !== SLICE2_VERSION && version !== SLICE3_VERSION) {
      await owner`INSERT INTO public.hub_migrations(version) VALUES (${version})`;
    }
  }
}

async function ensurePrerequisiteRoles(owner: PgClient) {
  const existing = await owner<
    {
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }[]
  >`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    from pg_roles where rolname=any(${[...OPTIONAL_PREREQUISITE_ROLES]})`;
  if (
    existing.some(
      (role) =>
        role.rolcanlogin ||
        role.rolsuper ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        role.rolreplication ||
        role.rolbypassrls,
    )
  ) {
    throw new Error('Notification outbox fixture prerequisite role has unsafe attributes');
  }
  const present = new Set(existing.map((role) => role.rolname));
  const created: (typeof OPTIONAL_PREREQUISITE_ROLES)[number][] = [];
  try {
    for (const role of OPTIONAL_PREREQUISITE_ROLES) {
      if (present.has(role)) continue;
      if (role === 'app_assistant_ro') {
        await owner.unsafe(
          'CREATE ROLE app_assistant_ro NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        );
      } else {
        await owner.unsafe(
          'CREATE ROLE service_role NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        );
      }
      created.push(role);
    }
  } catch (error) {
    await dropCreatedPrerequisiteRoles(owner, created).catch(() => undefined);
    throw error;
  }
  return Object.freeze(created);
}

async function dropCreatedPrerequisiteRoles(
  owner: PgClient,
  roles: readonly (typeof OPTIONAL_PREREQUISITE_ROLES)[number][],
) {
  for (const role of [...roles].reverse()) {
    if (role === 'app_assistant_ro') await owner.unsafe('DROP ROLE app_assistant_ro');
    else await owner.unsafe('DROP ROLE service_role');
  }
}

async function installSourceFixture(owner: PgClient) {
  await owner.unsafe(`
    CREATE TABLE public.notification_source_fixture (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      value text NOT NULL
    );
    ALTER TABLE public.notification_source_fixture ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.notification_source_fixture FORCE ROW LEVEL SECURITY;
    CREATE POLICY notification_source_fixture_org ON public.notification_source_fixture
      FOR ALL TO app_ledger
      USING (organization_id::text=current_setting('app.current_org_id',true))
      WITH CHECK (organization_id::text=current_setting('app.current_org_id',true));
    REVOKE ALL ON TABLE public.notification_source_fixture FROM PUBLIC;
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.notification_source_fixture TO app_ledger;
  `);
  await owner`INSERT INTO public.organizations(id) VALUES
    (${OUTBOX_ORG_A}::uuid),(${OUTBOX_ORG_B}::uuid),(${OUTBOX_ORG_C}::uuid)`;
}

function client(url: URL, applicationName: string, max: number) {
  return postgres(url.href, {
    max,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 3,
    idle_timeout: 10,
    connection: {
      application_name: applicationName,
      statement_timeout: 30_000,
    },
  });
}

export async function setupNotificationOutboxHarness(): Promise<NotificationOutboxHarness> {
  const parent = await openDisposablePostgres();
  const rootUrl = validateDisposableDatabaseUrl(
    process.env.MINION_QC_DATABASE_URL,
    process.env.MINION_QC_DISPOSABLE,
  );
  const [identity] = await parent.owner<
    { rolcreatedb: boolean; rolsuper: boolean; marker: string | null }[]
  >`SELECT r.rolcreatedb,r.rolsuper,shobj_description(d.oid,'pg_database') AS marker
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname=current_user AND d.datname=current_database()`;
  if (
    identity?.marker !== DISPOSABLE_DATABASE_MARKER ||
    (!identity.rolcreatedb && !identity.rolsuper)
  ) {
    await parent.close();
    throw new Error('Notification outbox fixture owner cannot create disposable children');
  }
  let createdPrerequisiteRoles: readonly (typeof OPTIONAL_PREREQUISITE_ROLES)[number][];
  try {
    createdPrerequisiteRoles = await ensurePrerequisiteRoles(parent.owner);
  } catch (error) {
    await parent.close();
    throw error;
  }
  const preexisting = await parent.owner<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname=ANY(${[...ROLE_NAMES]}) ORDER BY rolname`;
  if (preexisting.length) {
    await dropCreatedPrerequisiteRoles(parent.owner, createdPrerequisiteRoles);
    await parent.close();
    throw new Error('Notification outbox fixture roles must be absent before migration');
  }

  const childName = `${CHILD_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await parent.owner.unsafe(
    `CREATE DATABASE ${quoteChildDatabase(childName)} OWNER minion_qc TEMPLATE template0`,
  );
  await parent.owner.unsafe(
    `COMMENT ON DATABASE ${quoteChildDatabase(childName)} IS '${CHILD_MARKER}'`,
  );
  const childUrl = new URL(rootUrl);
  childUrl.pathname = `/${childName}`;
  const owner = client(childUrl, 'notification-outbox-owner', 2);
  const source = client(childUrl, 'notification-outbox-source', 12);
  const worker = client(childUrl, 'notification-outbox-worker', 8);
  const serialWorker = client(childUrl, 'notification-outbox-worker-serial', 1);
  const competitor = client(childUrl, 'notification-outbox-competitor', 4);

  try {
    await installPrerequisites(owner);
    const migration = command(childUrl, 'db-migrate.ts');
    if (migration.error || migration.signal || migration.code !== 0) {
      throw new Error(`Notification outbox migration failed: ${migration.stderr.slice(-2000)}`);
    }
    const status = command(childUrl, 'db-status.ts');
    if (status.error || status.signal || status.code !== 0) {
      throw new Error(`Notification outbox status failed: ${status.stderr.slice(-2000)}`);
    }
    const rerun = command(childUrl, 'db-migrate.ts');
    if (rerun.error || rerun.signal || rerun.code !== 0) {
      throw new Error(`Notification outbox migration rerun failed: ${rerun.stderr.slice(-2000)}`);
    }
    await installSourceFixture(owner);
    return Object.freeze({
      parent,
      childName,
      childUrl,
      owner,
      source,
      worker,
      serialWorker,
      competitor,
      createdPrerequisiteRoles,
      migration,
      rerun,
      status,
    });
  } catch (error) {
    await Promise.allSettled([
      owner.end({ timeout: 5 }),
      source.end({ timeout: 5 }),
      worker.end({ timeout: 5 }),
      serialWorker.end({ timeout: 5 }),
      competitor.end({ timeout: 5 }),
    ]);
    await parent.owner.unsafe(`DROP DATABASE ${quoteChildDatabase(childName)} WITH (FORCE)`);
    await parent.owner.unsafe('REVOKE notification_worker FROM minion_qc').catch(() => undefined);
    await parent.owner
      .unsafe('DROP ROLE IF EXISTS notification_event_trigger')
      .catch(() => undefined);
    await parent.owner.unsafe('DROP ROLE IF EXISTS notification_worker').catch(() => undefined);
    await dropCreatedPrerequisiteRoles(parent.owner, createdPrerequisiteRoles).catch(
      () => undefined,
    );
    await parent.close();
    throw error;
  }
}

export async function resetNotificationOutbox(harness: NotificationOutboxHarness) {
  await harness.owner.unsafe(
    'TRUNCATE TABLE public.notification_outbox,public.notification_events,public.notification_source_fixture',
  );
}

export async function teardownNotificationOutboxHarness(harness: NotificationOutboxHarness) {
  await Promise.allSettled([
    harness.owner.end({ timeout: 5 }),
    harness.source.end({ timeout: 5 }),
    harness.worker.end({ timeout: 5 }),
    harness.serialWorker.end({ timeout: 5 }),
    harness.competitor.end({ timeout: 5 }),
  ]);
  await harness.parent.owner.unsafe(
    `DROP DATABASE ${quoteChildDatabase(harness.childName)} WITH (FORCE)`,
  );
  await harness.parent.owner.unsafe('REVOKE notification_worker FROM minion_qc');
  await harness.parent.owner.unsafe('DROP ROLE notification_event_trigger');
  await harness.parent.owner.unsafe('DROP ROLE notification_worker');
  await dropCreatedPrerequisiteRoles(harness.parent.owner, harness.createdPrerequisiteRoles);
  const databases = await harness.parent.owner<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE ${CHILD_PREFIX + '%'}`;
  const roles = await harness.parent.owner<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname=ANY(${[
      ...ROLE_NAMES,
      ...harness.createdPrerequisiteRoles,
    ]})`;
  await harness.parent.close();
  if (databases.length || roles.length) {
    throw new Error('Notification outbox fixture cleanup left a child database or role');
  }
}
