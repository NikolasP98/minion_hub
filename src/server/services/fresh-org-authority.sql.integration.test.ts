import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

const boundary = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: boundary.pool }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: vi.fn() }));

import {
  FRESH_ORG_MEMBER_LIMIT,
  FreshOrgAuthorityOverflow,
  resolveFreshOrgMemberWithCapability,
  resolveFreshOrgMembersWithCapability,
  type FreshOrgAuthorityTables,
} from './fresh-org-authority';
import {
  prepareJoinReviewRecipients,
  recheckJoinReviewRecipient,
  type JoinReviewAuthority,
} from './join/notification-audience';

type Client = ReturnType<typeof postgres>;

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: Client;
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const ORG_ACTIVE = '51000000-0000-4000-8000-000000000001';
const ORG_INACTIVE = '51000000-0000-4000-8000-000000000002';
const ORG_OVERFLOW = '51000000-0000-4000-8000-000000000003';
const PROFILE_ALLOWED = '52000000-0000-4000-8000-000000000001';
const PROFILE_BLOCKED = '52000000-0000-4000-8000-000000000002';
const PROFILE_GLOBAL_ADMIN = '52000000-0000-4000-8000-000000000003';
const PROFILE_OUTSIDE_ADMIN = '52000000-0000-4000-8000-000000000004';
const PROFILE_UNCONFIRMED = '52000000-0000-4000-8000-000000000005';
const PROFILE_INACTIVE = '52000000-0000-4000-8000-000000000006';

const tables: Readonly<FreshOrgAuthorityTables> = Object.freeze({
  organizations: `${schema}.organizations`,
  organizationMembers: `${schema}.organization_members`,
  profiles: `${schema}.profiles`,
  authUsers: `${schema}.auth_users`,
  memberRoles: `${schema}.member_roles`,
  permissionRules: `${schema}.permission_rules`,
});

const authority: JoinReviewAuthority = {
  resolveMembers: (organizationId, module, action) =>
    resolveFreshOrgMembersWithCapability(
      organizationId,
      module,
      action,
      FRESH_ORG_MEMBER_LIMIT,
      tables,
    ),
  resolveMember: (organizationId, profileId, module, action) =>
    resolveFreshOrgMemberWithCapability(organizationId, profileId, module, action, tables),
};

async function seedAuthorityRows() {
  await owner`INSERT INTO organizations (id,name,status) VALUES
    (${ORG_ACTIVE},'Active tenant','active'),
    (${ORG_INACTIVE},'Inactive tenant','disabled')`;
  await owner`INSERT INTO profiles (id,email,role) VALUES
    (${PROFILE_ALLOWED},'profile-address@example.test','user'),
    (${PROFILE_BLOCKED},'blocked-profile@example.test','user'),
    (${PROFILE_GLOBAL_ADMIN},'global-profile@example.test','admin'),
    (${PROFILE_OUTSIDE_ADMIN},'outside-profile@example.test','admin'),
    (${PROFILE_UNCONFIRMED},'unconfirmed-profile@example.test','user'),
    (${PROFILE_INACTIVE},'inactive-profile@example.test','user')`;
  await owner`INSERT INTO auth_users (id,email,email_confirmed_at) VALUES
    (${PROFILE_ALLOWED},'Manager@Verified.Example',clock_timestamp()),
    (${PROFILE_BLOCKED},'blocked@verified.example',clock_timestamp()),
    (${PROFILE_GLOBAL_ADMIN},'admin@verified.example',clock_timestamp()),
    (${PROFILE_OUTSIDE_ADMIN},'outside@verified.example',clock_timestamp()),
    (${PROFILE_UNCONFIRMED},'unconfirmed@verified.example',NULL),
    (${PROFILE_INACTIVE},'inactive@verified.example',clock_timestamp())`;
  await owner`INSERT INTO organization_members (organization_id,profile_id,role) VALUES
    (${ORG_ACTIVE},${PROFILE_ALLOWED},'member'),
    (${ORG_ACTIVE},${PROFILE_BLOCKED},'admin'),
    (${ORG_ACTIVE},${PROFILE_GLOBAL_ADMIN},'viewer'),
    (${ORG_ACTIVE},${PROFILE_UNCONFIRMED},'admin'),
    (${ORG_INACTIVE},${PROFILE_INACTIVE},'admin')`;
  await owner`INSERT INTO member_roles (org_id,profile_id,role_key) VALUES
    (${ORG_ACTIVE},${PROFILE_ALLOWED},'custom-user-manager'),
    (${ORG_ACTIVE},${PROFILE_BLOCKED},'custom-blocked')`;
  await owner`INSERT INTO permission_rules
    (org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)
    VALUES
    (${ORG_ACTIVE},'custom-user-manager','users',true,false,false,false,false,true,false,0),
    (${ORG_ACTIVE},'custom-blocked','users',true,false,false,false,false,false,false,0)`;
}

beforeAll(async () => {
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(`CREATE SCHEMA "${schema}"`);
  owner = harness.createConnection(schema);
  await owner.unsafe(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE profiles (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      role text NOT NULL
    );
    CREATE TABLE auth_users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz
    );
    CREATE TABLE organization_members (
      organization_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (organization_id,profile_id)
    );
    CREATE TABLE member_roles (
      org_id uuid NOT NULL,
      profile_id uuid NOT NULL,
      role_key text NOT NULL,
      PRIMARY KEY (org_id,profile_id,role_key)
    );
    CREATE TABLE permission_rules (
      org_id uuid NOT NULL,
      role_key text NOT NULL,
      module text NOT NULL,
      can_view boolean NOT NULL,
      can_create boolean NOT NULL,
      can_edit boolean NOT NULL,
      can_delete boolean NOT NULL,
      can_export boolean NOT NULL,
      can_manage boolean NOT NULL,
      if_owner boolean NOT NULL,
      field_level smallint NOT NULL,
      PRIMARY KEY (org_id,role_key,module)
    )
  `);
  boundary.pool.mockImplementation(() => owner);
}, 20_000);

beforeEach(async () => {
  await owner`TRUNCATE organizations,profiles,auth_users,organization_members,member_roles,permission_rules`;
  await seedAuthorityRows();
});

afterAll(async () => {
  if (!harness) return;
  try {
    await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    expect(await harness.owner`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).toEqual(
      [],
    );
  } finally {
    await harness.close();
  }
});

describe('native fresh organization notification authority', () => {
  it('uses active exact-org membership, auth users destinations and current explicit permission overrides', async () => {
    await expect(
      resolveFreshOrgMembersWithCapability(
        ORG_ACTIVE,
        'users',
        'manage',
        FRESH_ORG_MEMBER_LIMIT,
        tables,
      ),
    ).resolves.toEqual([
      { profileId: PROFILE_ALLOWED, verifiedEmail: 'manager@verified.example' },
      { profileId: PROFILE_GLOBAL_ADMIN, verifiedEmail: 'admin@verified.example' },
      { profileId: PROFILE_UNCONFIRMED, verifiedEmail: null },
    ]);
    await expect(
      resolveFreshOrgMembersWithCapability(
        ORG_INACTIVE,
        'users',
        'manage',
        FRESH_ORG_MEMBER_LIMIT,
        tables,
      ),
    ).resolves.toEqual([]);
  });

  it('suppresses a prepared recipient after verified destination, permission or membership changes', async () => {
    const prepared = await prepareJoinReviewRecipients(ORG_ACTIVE, authority);
    expect(prepared).toEqual([
      { profileId: PROFILE_ALLOWED, email: 'manager@verified.example' },
      { profileId: PROFILE_GLOBAL_ADMIN, email: 'admin@verified.example' },
    ]);
    const candidate = prepared[0]!;

    await owner`UPDATE auth_users SET email='changed@verified.example' WHERE id=${PROFILE_ALLOWED}`;
    await expect(recheckJoinReviewRecipient(ORG_ACTIVE, candidate, authority)).resolves.toBe(false);

    await owner`UPDATE auth_users SET email='Manager@Verified.Example' WHERE id=${PROFILE_ALLOWED}`;
    await owner`UPDATE permission_rules SET can_manage=false
      WHERE org_id=${ORG_ACTIVE} AND role_key='custom-user-manager' AND module='users'`;
    await expect(recheckJoinReviewRecipient(ORG_ACTIVE, candidate, authority)).resolves.toBe(false);

    await owner`UPDATE permission_rules SET can_manage=true
      WHERE org_id=${ORG_ACTIVE} AND role_key='custom-user-manager' AND module='users'`;
    await owner`DELETE FROM organization_members
      WHERE organization_id=${ORG_ACTIVE} AND profile_id=${PROFILE_ALLOWED}`;
    await expect(recheckJoinReviewRecipient(ORG_ACTIVE, candidate, authority)).resolves.toBe(false);
  });

  it('rejects candidate limit plus one before filtering recipients', async () => {
    await owner`INSERT INTO organizations (id,name,status)
      VALUES (${ORG_OVERFLOW},'Overflow tenant','active')`;
    await owner.unsafe(`
      WITH generated AS (
        SELECT ('53000000-0000-4000-8000-' || lpad(to_hex(i),12,'0'))::uuid AS id,
               i
        FROM generate_series(1,${FRESH_ORG_MEMBER_LIMIT + 1}) AS source(i)
      ), inserted AS (
        INSERT INTO profiles (id,email,role)
        SELECT id,'overflow-' || i || '@example.test','user' FROM generated
        RETURNING id
      )
      INSERT INTO organization_members (organization_id,profile_id,role)
      SELECT '${ORG_OVERFLOW}'::uuid,id,'viewer' FROM inserted
    `);

    await expect(
      resolveFreshOrgMembersWithCapability(
        ORG_OVERFLOW,
        'users',
        'manage',
        FRESH_ORG_MEMBER_LIMIT,
        tables,
      ),
    ).rejects.toMatchObject({
      name: FreshOrgAuthorityOverflow.name,
      code: 'candidate_limit_exceeded',
      limit: FRESH_ORG_MEMBER_LIMIT,
    });
  });
});
