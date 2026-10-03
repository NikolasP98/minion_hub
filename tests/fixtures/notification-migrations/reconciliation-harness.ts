import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { expect } from 'vitest';
import {
  DISPOSABLE_DATABASE_MARKER,
  openDisposablePostgres,
  validateDisposableDatabaseUrl,
} from '../../../scripts/qc/disposable-postgres';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'notification-migrations');
export const TARGET_VERSION = '20261003140000';
export const TARGET_FILE = `${TARGET_VERSION}_notification_legacy_reconciliation.sql`;
const CHILD_MARKER = 'minion-notification-reconciliation-child:v1';
export const BASELINE = join(ROOT, 'supabase', 'qa', 'baseline');

export const ORG_A = 'notification-fixture-a';
export const ORG_B = 'notification-fixture-b';
export const BOOKING_A = '10000000-0000-4000-8000-000000000001';
const REMINDER_A = '20000000-0000-4000-8000-000000000001';
export const RULE_A = '30000000-0000-4000-8000-000000000001';
export const LOG_A = '40000000-0000-4000-8000-000000000001';

export type Sql = ReturnType<typeof postgres>;
export type LegacyState =
  'fresh' | 'reminder_base' | 'reminder_multichannel' | 'reminder_inference' | 'legacy_complete';

export let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let parentUrl: URL;
const childNames = new Set<string>();
export const fixtureRolesCreated = new Set<string>();

function quoteIdentifier(value: string) {
  if (!/^minion_qc_notification_[a-f0-9]{24}$/.test(value)) {
    throw new Error('Invalid notification child database identifier');
  }
  return `"${value}"`;
}

export function quoteRoleIdentifier(value: string) {
  if (
    ![
      'postgres',
      'supabase_admin',
      'notification_event_trigger',
      'notification_worker',
      'notification_coordinator',
      'notification_health_reader',
    ].includes(value) &&
    !/^minion_notification_(?:public_probe|membership)_[a-f0-9]{16}$/.test(value)
  ) {
    throw new Error('Invalid notification fixture role identifier');
  }
  return `"${value}"`;
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function replaceNth(source: string, needle: string, replacement: string, occurrence = 1) {
  let cursor = -1;
  for (let index = 0; index < occurrence; index++) {
    cursor = source.indexOf(needle, cursor + 1);
    if (cursor === -1) throw new Error('Notification migration mutation anchor is missing');
  }
  return source.slice(0, cursor) + replacement + source.slice(cursor + needle.length);
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

export async function createChild(label: string) {
  const name = `minion_qc_notification_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
  childNames.add(name);
  await harness.owner.unsafe(
    `CREATE DATABASE ${quoteIdentifier(name)} OWNER minion_qc TEMPLATE template0`,
  );
  await harness.owner.unsafe(`COMMENT ON DATABASE ${quoteIdentifier(name)} IS '${CHILD_MARKER}'`);
  const url = new URL(parentUrl);
  url.pathname = `/${name}`;
  const db = postgres(url.href, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 3,
    idle_timeout: 5,
    connection: {
      application_name: `notification-slice2-${label}`,
      statement_timeout: 30_000,
    },
  });
  return { name, url, db };
}

export async function dropChild(child: { name: string; db: Sql }) {
  await child.db.end({ timeout: 5 });
  await harness.owner.unsafe(`DROP DATABASE ${quoteIdentifier(child.name)} WITH (FORCE)`);
  childNames.delete(child.name);
}

export async function installPrerequisites(db: Sql) {
  const requiredRoles = ['app_ledger', 'app_assistant_ro', 'anon', 'authenticated', 'service_role'];
  const roles = await db<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname = ANY(${requiredRoles}) ORDER BY rolname`;
  expect(roles.map((row) => row.rolname)).toEqual([...requiredRoles].sort());
  await db.unsafe(`
    CREATE TABLE public.sched_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id text NOT NULL
    );
    CREATE TABLE public.hub_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER DEFAULT PRIVILEGES FOR ROLE minion_qc IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
  for (const version of migrationVersions()) {
    if (version !== TARGET_VERSION) {
      await db`INSERT INTO public.hub_migrations(version) VALUES (${version})`;
    }
  }
}

const fixtureFiles = [
  '20260618120000_scheduling_reminders.sql',
  '20260621200000_sched_reminders_multichannel.sql',
  '20260621220000_sched_reminder_infer_confirmation.sql',
  '20260622230000_notifications.sql',
] as const;

export async function installLegacyState(db: Sql, state: LegacyState) {
  if (state === 'fresh') return;
  const end =
    state === 'reminder_base'
      ? 1
      : state === 'reminder_multichannel'
        ? 2
        : state === 'reminder_inference'
          ? 3
          : 4;
  for (const file of fixtureFiles.slice(0, end)) {
    await db.unsafe(readFileSync(join(FIXTURES, 'legacy', file), 'utf8'));
  }
  if (state === 'legacy_complete') {
    await db.unsafe(
      'GRANT SELECT ON TABLE public.sched_reminders, public.notif_log TO app_assistant_ro',
    );
  }
}

export async function seedLegacyRows(db: Sql, state: LegacyState) {
  if (state === 'fresh') return;
  await db`INSERT INTO public.sched_bookings(id,org_id) VALUES (${BOOKING_A},${ORG_A})`;
  await db`INSERT INTO public.sched_reminder_config(org_id,enabled,from_name,updated_at)
    VALUES (${ORG_A},true,'Fixture sender','2026-01-02T03:04:05Z')`;
  await db.unsafe(
    `INSERT INTO public.sched_reminders
      (id,org_id,booking_id,stage,channel,recipient,content,status,message_id,error,sent_at,created_at)
     VALUES
      ('${REMINDER_A}','${ORG_A}','${BOOKING_A}','24h','email','fixture@example.invalid',
       'fixture reminder','sending',NULL,NULL,NULL,'2026-01-02T03:05:06Z')`,
  );
  if (state === 'legacy_complete') {
    await db`INSERT INTO public.notif_rules
      (id,org_id,name,enabled,trigger_table,trigger_event,date_field,date_offset_mins,
       condition,recipients,channel,account_id,template,last_run_at,created_at,updated_at)
      VALUES (${RULE_A},${ORG_A},'Fixture rule',true,'stk_items','update',null,null,
       '[]','[]','email',null,'Fixture template',null,'2026-01-02T03:06:07Z','2026-01-02T03:06:07Z')`;
    await db`INSERT INTO public.notif_log
      (id,org_id,rule_id,entity_id,trigger_key,channel,recipient,content,status,error,message_id,created_at)
      VALUES (${LOG_A},${ORG_A},${RULE_A},'fixture-entity','fixture-trigger','email',
       'fixture@example.invalid','fixture notification','sent',null,'fixture-message',
       '2026-01-02T03:07:08Z')`;
  }
}

export async function snapshotLegacyRows(db: Sql, state: LegacyState) {
  if (state === 'fresh') return null;
  const configColumns = [
    'org_id',
    'enabled',
    'stages',
    'channel',
    'account_id',
    'personalize',
    'locale',
    'from_name',
    'updated_at',
    ...(state === 'reminder_base' ? [] : ['channels']),
    ...(state === 'reminder_inference' || state === 'legacy_complete'
      ? ['infer_confirmation']
      : []),
  ];
  const reminderColumns = [
    'id',
    'org_id',
    'booking_id',
    'stage',
    'channel',
    'recipient',
    'content',
    'status',
    'message_id',
    'error',
    'sent_at',
    'created_at',
    ...(state === 'reminder_base' ? [] : ['recipient_role']),
  ];
  return {
    configColumns,
    reminderColumns,
    config: await db.unsafe(
      `SELECT ${configColumns.map((column) => `"${column}"`).join(',')} FROM public.sched_reminder_config ORDER BY org_id`,
    ),
    reminders: await db.unsafe(
      `SELECT ${reminderColumns.map((column) => `"${column}"`).join(',')} FROM public.sched_reminders ORDER BY id`,
    ),
    rules:
      state === 'legacy_complete' ? await db`SELECT * FROM public.notif_rules ORDER BY id` : [],
    log: state === 'legacy_complete' ? await db`SELECT * FROM public.notif_log ORDER BY id` : [],
  };
}

export function runMigration(url: URL) {
  const result = spawnSync('bun', [join(ROOT, 'scripts', 'db-migrate.ts')], {
    cwd: ROOT,
    env: {
      ...process.env,
      SUPABASE_DB_URL: url.href,
      FORCE_DB_MIGRATE: '1',
      VERCEL_ENV: 'test',
    },
    encoding: 'utf8',
    timeout: 45_000,
  });
  return {
    code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

export function runMigrationStatus(url: URL) {
  return spawnSync('bun', [join(ROOT, 'scripts', 'db-status.ts')], {
    cwd: ROOT,
    env: { ...process.env, SUPABASE_DB_URL: url.href },
    encoding: 'utf8',
    timeout: 45_000,
  });
}

export async function ensureFixtureRole(name: string, attributes: string) {
  const [existing] = await harness.owner<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${name}) AS exists`;
  if (existing?.exists) return;
  await harness.owner.unsafe(`CREATE ROLE ${quoteRoleIdentifier(name)} ${attributes}`);
  fixtureRolesCreated.add(name);
}

function restoreViaPsql(url: URL, sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', url.href], {
    cwd: ROOT,
    input: sql,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

export async function restoreSupportedBaseline(child: { url: URL; db: Sql }) {
  await ensureFixtureRole('postgres', 'SUPERUSER NOLOGIN');
  await ensureFixtureRole('supabase_admin', 'SUPERUSER NOLOGIN');
  await child.db.unsafe(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULL::uuid';
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  `);
  const schema = readFileSync(join(BASELINE, 'schema.sql'), 'utf8').replace(
    /^CREATE SCHEMA public;$/m,
    'CREATE SCHEMA IF NOT EXISTS public;',
  );
  const ledger = readFileSync(join(BASELINE, 'ledger.sql'), 'utf8');
  const schemaRestore = restoreViaPsql(
    child.url,
    `SET ROLE supabase_admin;\n${schema}\nRESET ROLE;\n`,
  );
  expect(schemaRestore.error).toBeUndefined();
  expect(schemaRestore.signal).toBeNull();
  expect(schemaRestore.status, schemaRestore.stderr.slice(-4_000)).toBe(0);
  const ledgerRestore = restoreViaPsql(
    child.url,
    `SET ROLE supabase_admin;\n${ledger}\nRESET ROLE;\n`,
  );
  expect(ledgerRestore.error).toBeUndefined();
  expect(ledgerRestore.signal).toBeNull();
  expect(ledgerRestore.status, ledgerRestore.stderr.slice(-4_000)).toBe(0);
  await child.db.unsafe('REASSIGN OWNED BY supabase_admin TO minion_qc');
}

export const finalColumnNames = {
  notif_log: [
    'id',
    'org_id',
    'rule_id',
    'entity_id',
    'trigger_key',
    'channel',
    'recipient',
    'content',
    'status',
    'error',
    'message_id',
    'created_at',
  ],
  notif_rules: [
    'id',
    'org_id',
    'name',
    'enabled',
    'trigger_table',
    'trigger_event',
    'date_field',
    'date_offset_mins',
    'condition',
    'recipients',
    'channel',
    'account_id',
    'template',
    'last_run_at',
    'created_at',
    'updated_at',
  ],
  sched_reminder_config: [
    'org_id',
    'enabled',
    'stages',
    'channel',
    'account_id',
    'personalize',
    'locale',
    'from_name',
    'updated_at',
    'channels',
    'infer_confirmation',
  ],
  sched_reminders: [
    'id',
    'org_id',
    'booking_id',
    'stage',
    'channel',
    'recipient',
    'content',
    'status',
    'message_id',
    'error',
    'sent_at',
    'created_at',
    'recipient_role',
  ],
} as const;

export async function assertCanonicalCatalog(db: Sql) {
  const relations = await db<
    { table: keyof typeof finalColumnNames; owner: string; rls: boolean; forceRls: boolean }[]
  >`
    SELECT c.relname AS table, pg_get_userbyid(c.relowner) AS owner,
      c.relrowsecurity AS rls, c.relforcerowsecurity AS "forceRls"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY(${Object.keys(finalColumnNames)})
    ORDER BY c.relname`;
  expect(relations.map(({ table, rls, forceRls }) => ({ table, rls, forceRls }))).toEqual(
    Object.keys(finalColumnNames)
      .sort()
      .map((table) => ({ table, rls: true, forceRls: true })),
  );
  expect(new Set(relations.map((row) => row.owner)).size).toBe(1);
  expect(
    relations.every(
      (row) =>
        !['app_ledger', 'app_assistant_ro', 'anon', 'authenticated', 'service_role'].includes(
          row.owner,
        ),
    ),
  ).toBe(true);

  const columns = await db<{ table: keyof typeof finalColumnNames; column: string }[]>`
    SELECT c.relname AS table,a.attname AS column
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname = ANY(${Object.keys(finalColumnNames)})
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`;
  for (const [table, expected] of Object.entries(finalColumnNames)) {
    expect(columns.filter((row) => row.table === table).map((row) => row.column)).toEqual(expected);
  }

  const policies = await db<
    { table: string; name: string; roles: string[]; using: string; check: string }[]
  >`
    SELECT c.relname AS table,p.polname AS name,
      ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
        FROM unnest(p.polroles) role_oid ORDER BY 1) AS roles,
      pg_get_expr(p.polqual,p.polrelid,true) AS using,
      pg_get_expr(p.polwithcheck,p.polrelid,true) AS check
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relname = ANY(${Object.keys(finalColumnNames)}) ORDER BY c.relname,p.polname`;
  expect(policies).toHaveLength(4);
  for (const policy of policies) {
    expect(policy).toEqual({
      table: policy.table,
      name: `${policy.table}_org_guc`,
      roles: ['app_ledger'],
      using: "org_id = current_setting('app.current_org_id'::text, true)",
      check: "org_id = current_setting('app.current_org_id'::text, true)",
    });
  }

  const stableConstraints = await db<{ table: string; name: string; type: string; def: string }[]>`
    SELECT c.conrelid::regclass::text AS table,c.conname AS name,c.contype AS type,
      pg_get_constraintdef(c.oid,true) AS def
    FROM pg_constraint c
    WHERE c.conrelid IN (
      'public.sched_reminder_config'::regclass,'public.sched_reminders'::regclass,
      'public.notif_rules'::regclass,'public.notif_log'::regclass
    ) AND c.contype <> 'n'
    ORDER BY c.conrelid::regclass::text,c.conname`;
  expect(stableConstraints.map((row) => row.name)).toEqual([
    'notif_log_pkey',
    'notif_log_status_check',
    'notif_rules_pkey',
    'sched_reminder_config_pkey',
    'sched_reminders_booking_id_fkey',
    'sched_reminders_pkey',
    'sched_reminders_status_check',
    'sched_reminders_status_sent_at_check',
  ]);
  expect(stableConstraints.find((row) => row.name === 'sched_reminders_booking_id_fkey')?.def).toBe(
    'FOREIGN KEY (booking_id) REFERENCES sched_bookings(id) ON DELETE CASCADE',
  );

  const indexes = await db<{ name: string }[]>`
    SELECT ci.relname AS name FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
    WHERE i.indrelid IN (
      'public.sched_reminder_config'::regclass,'public.sched_reminders'::regclass,
      'public.notif_rules'::regclass,'public.notif_log'::regclass
    ) ORDER BY ci.relname`;
  expect(indexes.map((row) => row.name)).toEqual([
    'notif_log_org_idx',
    'notif_log_pkey',
    'notif_log_rule_entity_key_uniq',
    'notif_rules_org_idx',
    'notif_rules_pkey',
    'sched_reminder_config_pkey',
    'sched_reminders_booking_idx',
    'sched_reminders_booking_stage_chan_uniq',
    'sched_reminders_org_created_idx',
    'sched_reminders_pkey',
  ]);

  const [comments] = await db<{ tableComment: string; statusComment: string }[]>`
    SELECT obj_description('public.notif_log'::regclass,'pg_class') AS "tableComment",
      col_description('public.notif_log'::regclass,
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.notif_log'::regclass AND attname='status')) AS "statusComment"`;
  expect(comments?.tableComment).toContain('Legacy notification claims');
  expect(comments?.statusComment).toContain('not provider acceptance');
}

export async function catalogDigest(db: Sql) {
  const catalog = await db<
    {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      relacl: string;
      columns: unknown;
      constraints: unknown;
      indexes: unknown;
      triggers: unknown;
      rules: unknown;
    }[]
  >`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      COALESCE(c.relacl::text,'') AS relacl,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
          'notnull',a.attnotnull,'acl',a.attacl::text,
          'default',pg_get_expr(d.adbin,d.adrelid,true)
        ) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d
          ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      ),'[]'::jsonb) AS columns,
      COALESCE((SELECT jsonb_agg(pg_get_constraintdef(k.oid,true) ORDER BY k.conname)
        FROM pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb) AS constraints,
      COALESCE((SELECT jsonb_agg(pg_get_indexdef(i.indexrelid,0,true) ORDER BY i.indexrelid::regclass::text)
        FROM pg_index i WHERE i.indrelid=c.oid),'[]'::jsonb) AS indexes,
      COALESCE((SELECT jsonb_agg(pg_get_triggerdef(t.oid,true) ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb) AS triggers,
      COALESCE((SELECT jsonb_agg(pg_get_ruledef(r.oid,true) ORDER BY r.rulename)
        FROM pg_rewrite r WHERE r.ev_class=c.oid AND r.rulename<>'_RETURN'),'[]'::jsonb) AS rules
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('sched_reminder_config','sched_reminders','notif_rules','notif_log')
    ORDER BY c.relname`;
  const rows: Record<string, unknown> = {};
  for (const table of ['sched_reminder_config', 'sched_reminders', 'notif_rules', 'notif_log']) {
    const exists = catalog.some((row) => row.relname === table);
    rows[table] = exists
      ? await db.unsafe(
          `SELECT to_jsonb(t) AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text`,
        )
      : [];
  }
  return sha256(JSON.stringify({ catalog, rows }));
}

export async function setupNotificationMigrationHarness() {
  harness = await openDisposablePostgres();
  parentUrl = validateDisposableDatabaseUrl(
    process.env.MINION_QC_DATABASE_URL,
    process.env.MINION_QC_DISPOSABLE,
  );
  const [owner] = await harness.owner<
    { rolcreatedb: boolean; rolsuper: boolean; marker: string | null }[]
  >`SELECT r.rolcreatedb,r.rolsuper,shobj_description(d.oid,'pg_database') AS marker
      FROM pg_roles r CROSS JOIN pg_database d
      WHERE r.rolname=current_user AND d.datname=current_database()`;
  expect(owner).toMatchObject({ marker: DISPOSABLE_DATABASE_MARKER });
  expect(owner?.rolcreatedb || owner?.rolsuper).toBe(true);
}

export async function teardownNotificationMigrationHarness() {
  if (!harness) return;
  try {
    for (const name of childNames) {
      await harness.owner.unsafe(`DROP DATABASE ${quoteIdentifier(name)} WITH (FORCE)`);
    }
    const leftovers = await harness.owner<{ datname: string; marker: string | null }[]>`
        SELECT datname,shobj_description(oid,'pg_database') AS marker
        FROM pg_database WHERE datname LIKE 'minion_qc_notification_%'`;
    expect(leftovers.filter((row) => row.marker === CHILD_MARKER)).toEqual([]);
    for (const role of [...fixtureRolesCreated].reverse()) {
      await harness.owner.unsafe(`DROP ROLE IF EXISTS ${quoteRoleIdentifier(role)}`);
      fixtureRolesCreated.delete(role);
    }
  } finally {
    await harness.close();
  }
}
