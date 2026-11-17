import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal postgres-js shape the helper needs: the qualified owner handle of the OWNED child. */
export interface FixtureOwner {
  unsafe(query: string): PromiseLike<readonly Record<string, unknown>[]>;
}

export interface OwnedChildIdentity {
  /** Recorded child database name: minion_qc_faces_<feature>_<32 hex>. */
  name: string;
  /** Marker comment on the child database. */
  marker: string;
  /** Feature prefix the child name must start with. */
  prefix: string;
}

const SQL_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'operator-native-auth.sql',
);
const CHILD_RE = /^minion_qc_faces_[a-z0-9]+_[0-9a-f]{32}$/;
const INERT = 'NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS';
/** ACL-recipient sentinels named by canonical baseline grants; inert, no memberships. */
const SENTINEL_ROLES = [
  'postgres',
  'service_role',
  'supabase_auth_admin',
  'dashboard_user',
  'app_assistant_ro',
  'brain_vector_worker',
] as const;

async function one(owner: FixtureOwner, query: string) {
  return (await owner.unsafe(query))[0] as Record<string, unknown> | undefined;
}

async function assertOwnedChild(owner: FixtureOwner, id: OwnedChildIdentity) {
  if (!CHILD_RE.test(id.name) || !id.name.startsWith(`minion_qc_faces_${id.prefix}_`)) {
    throw new Error('operator native auth: not an owned feature child database');
  }
  const row = await one(
    owner,
    `select current_database() as db, current_user as usr,
            pg_catalog.shobj_description((select oid from pg_catalog.pg_database where datname=current_database()),'pg_database') as marker,
            (select rolsuper from pg_catalog.pg_roles where rolname=current_user) as super`,
  );
  if (!row || row.db !== id.name || row.marker !== id.marker || row.super !== true) {
    throw new Error('operator native auth: owner is not the qualified owned child');
  }
}

async function ensureInertRole(owner: FixtureOwner, role: string) {
  const row = await one(
    owner,
    `select rolcanlogin, rolinherit, rolsuper, rolbypassrls,
            exists(select 1 from pg_catalog.pg_auth_members m where m.roleid=r.oid or m.member=r.oid) as edges
       from pg_catalog.pg_roles r where rolname='${role}'`,
  );
  if (!row) {
    await owner.unsafe(`CREATE ROLE ${role} ${INERT}`);
    return;
  }
  if (row.rolcanlogin || row.rolinherit || row.rolsuper || row.rolbypassrls || row.edges) {
    throw new Error(`operator native auth: role ${role} is not inert`);
  }
}

/** Child-only: ensures sentinel roles, then installs auth schema/users/uid. Never creates or drops a database. */
export async function installOperatorNativeAuthFixture(
  owner: FixtureOwner,
  id: OwnedChildIdentity,
): Promise<void> {
  await assertOwnedChild(owner, id);
  for (const role of SENTINEL_ROLES) await ensureInertRole(owner, role);
  await owner.unsafe(await readFile(SQL_FILE, 'utf8'));
}

/** After public source DDL/seed: catalog, FK and JWT assertions. */
export async function assertOperatorNativeAuthFixture(
  owner: FixtureOwner,
  id: OwnedChildIdentity,
): Promise<void> {
  await assertOwnedChild(owner, id);
  const fn = await one(
    owner,
    `select pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.provolatile,
            pg_catalog.has_function_privilege('dashboard_user', p.oid, 'EXECUTE') as dash,
            (select pg_catalog.count(*) from pg_catalog.pg_auth_members) as edges
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='auth' and p.proname='uid'`,
  );
  if (
    !fn ||
    fn.owner !== 'supabase_auth_admin' ||
    fn.prosecdef ||
    fn.provolatile !== 's' ||
    !fn.dash
  ) {
    throw new Error('operator native auth: auth.uid() catalog mismatch');
  }
  const jwt = await one(owner, 'select auth.uid() as uid');
  if (jwt?.uid !== null)
    throw new Error('operator native auth: auth.uid() must be NULL without a JWT');
  const users = await one(
    owner,
    `select (select count(*) from pg_catalog.pg_attribute where attrelid='auth.users'::regclass and attname in ('id','email') and not attisdropped) as cols`,
  );
  if (Number(users?.cols) !== 2) throw new Error('operator native auth: auth.users shape mismatch');
  const fk = await one(
    owner,
    `select count(*) as n from pg_catalog.pg_constraint where conname='profiles_id_fkey' and confrelid='auth.users'::regclass`,
  );
  if (Number(fk?.n) !== 1) throw new Error('operator native auth: profiles_id_fkey missing');
}
