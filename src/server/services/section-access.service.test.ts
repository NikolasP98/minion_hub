import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';

const core = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => core }));
vi.mock('./rbac.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireOrgCapability: async () => null,
}));
import {
  readSectionAccess,
  writeSectionAccess,
  listRoleAccessMatrix,
  deleteRoleAccessCatalog,
  resetRegisteredRolePolicies,
} from './section-access.service';
import { runWithEffectiveAuthority } from '$server/auth/effective-authority';
import { buildCapabilities } from './rbac.service';
const managerAuthority = () =>
  buildCapabilities(
    ['manager'],
    [
      {
        role_key: 'manager',
        module: 'users',
        can_view: true,
        can_create: false,
        can_edit: false,
        can_delete: false,
        can_export: false,
        can_manage: true,
      },
    ],
  );
import { writeNavConfig } from './nav-config.service';
import {
  POST as legacyPost,
  DELETE as legacyDelete,
} from '../../routes/api/roles/overrides/+server';
const client = new PGlite();
const db = drizzle(client);
const dialect = new PgDialect();
const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const profile = '20000000-0000-4000-8000-000000000001';
const locals = {
  user: {
    id: profile,
    supabaseId: profile,
    role: 'user',
    email: 'fixture@example.invalid',
    displayName: 'Fixture',
  },
  tenantCtx: { tenantId: org },
} as App.Locals;

// Execute production SQL against PostgreSQL, adapting only the driver row-array
// shape. PGlite is a single-process engine: its advisory lock is a no-op here;
// multi-connection lock behavior needs the loopback native-Postgres lane.
function nativeShape(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): CoreTx {
  return new Proxy(tx, {
    get(target, key, receiver) {
      if (key === 'execute')
        return async (query: SQL) => {
          const wire = dialect.sqlToQuery(query);
          if (wire.sql.includes('pg_advisory_xact_lock')) return [];
          return (await target.execute(query)).rows;
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as CoreTx;
}
beforeAll(async () => {
  await client.exec(`
    create role app_ledger;
    create table organizations(id uuid primary key,name text,status text);
    create table profiles(id uuid primary key,role text);
    create table organization_members(organization_id uuid,profile_id uuid,role text);
    create table member_roles(org_id uuid,profile_id uuid,role_key text);
    create table permission_roles(key text primary key,name text,rank integer,description text,is_system boolean);
    create table org_roles(org_id uuid,key text,name text,rank integer,source_role_key text);
    create table permission_rules(org_id uuid,role_key text,module text,can_view boolean,can_create boolean,can_edit boolean,
      can_delete boolean,can_export boolean,can_manage boolean,if_owner boolean default false,field_level integer default 0,
      updated_at timestamptz default now(),unique(org_id,role_key,module));
    create table app_nav_config(org_id text primary key,value jsonb,updated_at timestamptz default now());
    grant select,insert,update,delete on app_nav_config to app_ledger;
    alter table app_nav_config enable row level security;
    alter table app_nav_config force row level security;
    create policy nav_org_scope on app_nav_config for all to app_ledger using(org_id=current_setting('app.current_org_id',true)) with check(org_id=current_setting('app.current_org_id',true));
    create table doc_audit_log(org_id text,ref_type text,ref_id uuid,actor_id uuid,actor_name text,op text,changes jsonb,
      simulation_role_key text,simulation_generation uuid);
  `);
});
afterAll(() => client.close());
beforeEach(async () => {
  core.transaction.mockImplementation((fn: (tx: CoreTx) => Promise<unknown>) =>
    db.transaction((tx) => fn(nativeShape(tx))),
  );
  await client.exec(
    'truncate organizations,profiles,organization_members,member_roles,permission_roles,org_roles,permission_rules,app_nav_config,doc_audit_log',
  );
  await client.query(
    "insert into organizations values ($1,'Fixture org','active'),($2,'Other org','active')",
    [org, otherOrg],
  );
  await client.query("insert into profiles values ($1,'user')", [profile]);
  await client.query("insert into organization_members values ($1,$2,'member')", [org, profile]);
  await client.query("insert into member_roles values ($1,$2,'manager')", [org, profile]);
  await client.exec(`insert into permission_roles values ('owner','Owner',100,null,true),('admin','Admin',80,null,true),
    ('manager','Manager',60,null,true),('staff','Staff',40,null,true),('viewer','Viewer',20,null,true)`);
  await client.query(
    `insert into permission_rules (org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)
    values ($1,'manager','users',true,false,false,false,false,true)`,
    [org],
  );
  await client.query(`insert into app_nav_config(org_id,value) values ($1,$2::jsonb)`, [
    org,
    JSON.stringify({
      version: 1,
      sections: [
        {
          id: 'abc123',
          slug: 'team',
          label: 'Team',
          pages: [
            {
              id: 'def456',
              slug: 'customers',
              label: 'Customers',
              kind: 'link',
              target: '/crm/customers',
            },
          ],
        },
      ],
      builtin: {},
      builtinSections: {},
    }),
  ]);
});
const view = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
  manage: false,
};
async function revision(target: string, roleKey = 'viewer') {
  return (await readSectionAccess(locals, target)).roles.find((role) => role.key === roleKey)!
    .revision;
}
async function write(target: string, mode: 'deny' | 'inherit' | 'override', extra = {}) {
  return writeSectionAccess(locals, {
    target,
    roleKey: 'viewer',
    revision: await revision(target),
    mode,
    ...extra,
  });
}
describe('contextual/legacy policy shared persistence', () => {
  it('permits users:manage without settings:manage; canonical Settings carries identical revisions', async () => {
    const snapshot = await readSectionAccess(locals, 'crm');
    expect(snapshot.roles.find((r) => r.key === 'viewer')?.effective.view).toBe(true);
    const matrix = await listRoleAccessMatrix(org);
    expect(
      matrix.find((r) => r.key === 'viewer')?.modules.find((m) => m.module === 'crm')?.revision,
    ).toBe(snapshot.roles.find((r) => r.key === 'viewer')?.revision);
    const saved = await write('crm', 'deny');
    expect(saved.ok).toBe(true);
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(1);
  });
  it('distinguishes explicit deny from inherited permission and retains actual actor audit', async () => {
    await write('section:abc123', 'deny');
    const denied = await readSectionAccess(locals, 'section:abc123');
    expect(denied.roles.find((r) => r.key === 'viewer')).toMatchObject({
      effective: { view: false },
      explicit: { caps: { view: false } },
    });
    await write('section:abc123', 'inherit');
    const inherited = await readSectionAccess(locals, 'section:abc123');
    expect(inherited.roles.find((r) => r.key === 'viewer')).toMatchObject({
      effective: { view: true },
      explicit: null,
    });
    const audit = (
      await client.query<{ actor_id: string; changes: unknown[] }>('select * from doc_audit_log')
    ).rows;
    expect(audit).toHaveLength(2);
    expect(audit.every((entry) => entry.actor_id === profile)).toBe(true);
  });
  it('rejects protected owner, unknown/foreign/deleted targets and unknown org role before writing', async () => {
    await expect(
      writeSectionAccess(locals, {
        target: 'crm',
        roleKey: 'owner',
        revision: await revision('crm', 'owner'),
        mode: 'deny',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      writeSectionAccess(locals, {
        target: 'section:fff000',
        roleKey: 'viewer',
        revision: 'a'.repeat(64),
        mode: 'deny',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      writeSectionAccess(locals, {
        target: 'crm',
        roleKey: 'custom-foreign',
        revision: 'a'.repeat(64),
        mode: 'deny',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(0);
  });
  it('preserves omitted record/field scopes and normalizes action dependency', async () => {
    await client.query(
      `insert into permission_rules values ($1,'viewer','crm',true,false,false,false,false,false,true,0,now())`,
      [org],
    );
    await write('crm', 'override', { caps: { ...view, edit: true } });
    const after = (await readSectionAccess(locals, 'crm')).roles.find((r) => r.key === 'viewer')!;
    expect(after.inheritedIfOwner).toBe(false);
    expect(after.inheritedFieldLevel).toBe(1);
    expect(after.explicit).toMatchObject({ ifOwner: true, fieldLevel: 0, caps: { edit: true } });
    await write('crm', 'override', { caps: { ...view, view: false, edit: true } });
    expect(
      (await readSectionAccess(locals, 'crm')).roles.find((r) => r.key === 'viewer')?.effective
        .edit,
    ).toBe(false);
  });
  it('conflicts on stale first overrides and parent changes; no partial batch persists', async () => {
    const old = await revision('crm');
    await write('crm', 'deny');
    await expect(
      writeSectionAccess(locals, {
        target: 'crm',
        roleKey: 'viewer',
        revision: old,
        mode: 'override',
        caps: view,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const parent = await revision('crm');
    const sub = await revision('crm.insights');
    await write('crm.insights', 'deny');
    await expect(
      writeSectionAccess(
        locals,
        { target: 'crm', roleKey: 'viewer', revision: parent, mode: 'override', caps: view },
        [{ target: 'crm.insights', revision: sub }],
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await readSectionAccess(locals, 'crm')).roles.find((r) => r.key === 'viewer')?.effective
        .view,
    ).toBe(false);
  });
  it('rolls back mutation when audit persistence fails', async () => {
    const old = await revision('crm');
    await client.exec(
      "alter table doc_audit_log add constraint audit_failure check (op <> 'permission')",
    );
    try {
      await expect(
        writeSectionAccess(locals, {
          target: 'crm',
          roleKey: 'viewer',
          revision: old,
          mode: 'deny',
        }),
      ).rejects.toThrow();
      expect(await revision('crm')).toBe(old);
      expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(0);
    } finally {
      await client.exec('alter table doc_audit_log drop constraint audit_failure');
    }
  });
  it('rejects simulated role without effective users:manage and records selected metadata for allowed writes', async () => {
    const generation = '30000000-0000-4000-8000-000000000001';
    const base = { orgId: org, profileId: profile, generation, rank: 60, invalid: false };
    const denied = { ...base, roleKey: 'viewer', capabilities: buildCapabilities(['viewer'], []) };
    await expect(
      runWithEffectiveAuthority(denied, () => readSectionAccess(locals, 'crm')),
    ).rejects.toMatchObject({ status: 403 });
    const allowed = {
      ...base,
      roleKey: 'manager',
      capabilities: managerAuthority(),
    };
    await runWithEffectiveAuthority(allowed, () => write('crm', 'deny'));
    expect(
      (await client.query('select simulation_role_key,simulation_generation from doc_audit_log'))
        .rows[0],
    ).toMatchObject({ simulation_role_key: 'manager', simulation_generation: generation });
  });

  it('rejects forged owner writes through both real legacy HTTP handlers during simulation', async () => {
    const generation = '30000000-0000-4000-8000-000000000001';
    const authority = {
      orgId: org,
      profileId: profile,
      generation,
      rank: 60,
      invalid: false,
      roleKey: 'manager',
      capabilities: managerAuthority(),
    };
    const ownerRevision = await revision('crm', 'owner');
    const body = { roleKey: 'owner', module: 'crm', revision: ownerRevision };
    for (const [method, handler, payload] of [
      ['POST', legacyPost, { ...body, caps: view }],
      ['DELETE', legacyDelete, body],
    ] as const) {
      const request = new Request('https://fixture.invalid/api/roles/overrides', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await expect(
        runWithEffectiveAuthority(authority, () => handler({ locals, request } as never)),
      ).rejects.toMatchObject({ status: 403, body: { message: 'Owner access is protected' } });
    }
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(0);
  });
  it('detects cross-editor stale legacy revisions and atomically resets children', async () => {
    const old = await revision('crm');
    await write('crm', 'deny');
    const request = new Request('https://fixture.invalid/api/roles/overrides', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleKey: 'viewer', module: 'crm', revision: old, caps: view }),
    });
    await expect(legacyPost({ locals, request } as never)).rejects.toMatchObject({ status: 409 });
    await write('crm.insights', 'deny');
    const beforeChild = await revision('crm.insights');
    const result = await writeSectionAccess(
      locals,
      {
        target: 'crm',
        roleKey: 'viewer',
        revision: await revision('crm'),
        mode: 'override',
        caps: view,
      },
      [{ target: 'crm.insights', revision: beforeChild }],
    );
    expect(result.revisions?.['crm.insights']).not.toBe(beforeChild);
    expect(
      (await readSectionAccess(locals, 'crm.insights')).roles.find((r) => r.key === 'viewer')
        ?.explicit,
    ).toBe(null);
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(4);
  });
  it('resets displayed registered policies once through legacy DELETE and leaves navigation policies intact', async () => {
    for (const target of ['crm', 'crm.insights', 'sales', 'section:abc123', 'page:def456'])
      await write(target, 'deny');
    const resets = await Promise.all(
      ['crm', 'crm.insights', 'sales'].map(async (target) => ({
        target,
        revision: await revision(target),
      })),
    );
    const beforeAudit = (await client.query('select * from doc_audit_log')).rows.length;
    const request = new Request('https://fixture.invalid/api/roles/overrides', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleKey: 'viewer', resetRegisteredPolicies: resets }),
    });
    const response = await legacyDelete({ locals, request } as never);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt.ok).toBe(true);
    for (const { target } of resets) {
      expect(receipt.revisions[target]).toBe(await revision(target));
      expect(
        (await readSectionAccess(locals, target)).roles.find((r) => r.key === 'viewer')?.explicit,
      ).toBeNull();
    }
    expect(receipt.revision).toBe(receipt.revisions.crm);
    expect(receipt.revisions['crm.cleanup']).toBe(await revision('crm.cleanup'));
    expect(
      (
        await client.query<{ module: string }>(
          `select module from permission_rules where role_key='viewer' order by module`,
        )
      ).rows.map((r) => r.module),
    ).toEqual(['page:def456', 'section:abc123']);
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(beforeAudit + 3);
  });
  it('validates all registered reset revisions before any clear or audit', async () => {
    await write('crm', 'deny');
    await write('crm.insights', 'deny');
    await write('sales', 'deny');
    const resets = await Promise.all(
      ['crm', 'crm.insights', 'sales'].map(async (target) => ({
        target,
        revision: await revision(target),
      })),
    );
    await write('crm.insights', 'override', { caps: view });
    const beforeAudit = (await client.query('select * from doc_audit_log')).rows.length;
    await expect(resetRegisteredRolePolicies(locals, 'viewer', resets)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await readSectionAccess(locals, 'crm')).roles.find((r) => r.key === 'viewer')?.explicit?.caps
        .view,
    ).toBe(false);
    expect(
      (await readSectionAccess(locals, 'sales')).roles.find((r) => r.key === 'viewer')?.explicit
        ?.caps.view,
    ).toBe(false);
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(beforeAudit);
  });
  it('registered role reset rejects owner, duplicate, unknown and navigation targets atomically', async () => {
    const crm = await revision('crm');
    await expect(
      resetRegisteredRolePolicies(locals, 'owner', [
        { target: 'crm', revision: await revision('crm', 'owner') },
      ]),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      resetRegisteredRolePolicies(locals, 'viewer', [
        { target: 'crm', revision: crm },
        { target: 'crm', revision: crm },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    for (const target of ['crm.unknown', 'section:abc123', 'page:def456']) {
      await expect(
        resetRegisteredRolePolicies(locals, 'viewer', [
          { target: 'crm', revision: crm },
          { target, revision: crm },
        ]),
      ).rejects.toMatchObject({ status: 400 });
      const request = new Request('https://fixture.invalid/api/roles/overrides', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleKey: 'viewer',
          resetRegisteredPolicies: [{ target, revision: crm }],
        }),
      });
      await expect(legacyDelete({ locals, request } as never)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(0);
  });
  it('registered reset retains selected-action, real-rank and inherited grant ceilings', async () => {
    await write('crm', 'deny');
    const resets = [{ target: 'crm', revision: await revision('crm') }];
    const base = {
      orgId: org,
      profileId: profile,
      generation: '30000000-0000-4000-8000-000000000001',
      rank: 60,
      invalid: false,
    };
    await expect(
      runWithEffectiveAuthority(
        { ...base, roleKey: 'viewer', capabilities: buildCapabilities(['viewer'], []) },
        () => resetRegisteredRolePolicies(locals, 'viewer', resets),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      resetRegisteredRolePolicies(locals, 'admin', [
        { target: 'crm', revision: await revision('crm', 'admin') },
      ]),
    ).rejects.toMatchObject({ status: 403 });
    await client.query(
      `insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage) values($1,'manager','crm',false,false,false,false,false,false)`,
      [org],
    );
    await expect(resetRegisteredRolePolicies(locals, 'viewer', resets)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await readSectionAccess(locals, 'crm')).roles.find((r) => r.key === 'viewer')?.explicit?.caps
        .view,
    ).toBe(false);
  });
  it('a parent reset cannot grant inherited subresource access beyond actor authority', async () => {
    await write('crm', 'deny');
    const resets = [{ target: 'crm', revision: await revision('crm') }];
    await client.query(
      `insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage) values($1,'manager','crm.insights',false,false,false,false,false,false)`,
      [org],
    );
    await expect(resetRegisteredRolePolicies(locals, 'viewer', resets)).rejects.toMatchObject({
      status: 403,
    });
    await expect(write('crm', 'inherit')).rejects.toMatchObject({ status: 403 });
    expect(await revision('crm')).toBe(resets[0].revision);
  });
  it('registered reset rolls back all cells when a later audit insert fails', async () => {
    await write('crm', 'deny');
    await write('sales', 'deny');
    const resets = await Promise.all(
      ['crm', 'sales'].map(async (target) => ({ target, revision: await revision(target) })),
    );
    const beforeAudit = (await client.query('select * from doc_audit_log')).rows.length;
    await client.exec(
      "alter table doc_audit_log add constraint reset_audit_failure check (changes->0->>'field' <> 'sales') not valid",
    );
    try {
      await expect(resetRegisteredRolePolicies(locals, 'viewer', resets)).rejects.toThrow();
      for (const { target, revision: before } of resets)
        expect(await revision(target)).toBe(before);
      expect((await client.query('select * from doc_audit_log')).rows).toHaveLength(beforeAudit);
    } finally {
      await client.exec('alter table doc_audit_log drop constraint reset_audit_failure');
    }
  });
  it('includes inherited module and section changes in a page revision', async () => {
    const before = await revision('page:def456');
    await write('crm', 'deny');
    expect(await revision('page:def456')).not.toBe(before);
    const afterModule = await revision('page:def456');
    await write('section:abc123', 'deny');
    expect(await revision('page:def456')).not.toBe(afterModule);
  });

  it('commits whole-nav replacement and orphan policy audits together, or rolls both back', async () => {
    await write('section:abc123', 'deny');
    const before = (await client.query<{ value: unknown }>('select value from app_nav_config'))
      .rows[0].value;
    const context = {
      tenantId: org,
      profileId: profile,
      db: {
        transaction: (fn: (tx: CoreTx) => Promise<unknown>) =>
          db.transaction((tx) => fn(nativeShape(tx))),
      },
    } as never;
    const empty = { version: 1 as const, sections: [], builtinSections: {}, builtin: {} };
    await client.exec(
      "alter table doc_audit_log add constraint prune_audit_failure check (op <> 'target_removed')",
    );
    try {
      await expect(writeNavConfig(context, empty)).rejects.toThrow();
      expect(
        (await client.query<{ value: unknown }>('select value from app_nav_config')).rows[0].value,
      ).toEqual(before);
      expect(
        (await client.query("select * from permission_rules where module='section:abc123'")).rows,
      ).toHaveLength(1);
    } finally {
      await client.exec('alter table doc_audit_log drop constraint prune_audit_failure');
    }
    await writeNavConfig(context, empty);
    expect(
      (await client.query("select * from permission_rules where module='section:abc123'")).rows,
    ).toHaveLength(0);
    expect(
      (await client.query("select * from doc_audit_log where op='target_removed'")).rows,
    ).toHaveLength(1);
  });

  it('deletes a custom catalog role and all its policies atomically and refuses assigned roles', async () => {
    await client.query("insert into org_roles values ($1,'custom-temp','Temporary',20,'viewer')", [
      org,
    ]);
    const rev = (await readSectionAccess(locals, 'crm')).roles.find(
      (role) => role.key === 'custom-temp',
    )!.revision;
    await writeSectionAccess(locals, {
      target: 'crm',
      roleKey: 'custom-temp',
      revision: rev,
      mode: 'deny',
    });
    await client.query("insert into member_roles values ($1,$2,'custom-temp')", [org, profile]);
    await expect(deleteRoleAccessCatalog(locals, 'custom-temp')).rejects.toMatchObject({
      status: 409,
    });
    await client.query("delete from member_roles where role_key='custom-temp'");
    await client.exec(
      "alter table doc_audit_log add constraint role_audit_failure check (op <> 'role_delete')",
    );
    try {
      await expect(deleteRoleAccessCatalog(locals, 'custom-temp')).rejects.toThrow();
      expect(
        (await client.query("select * from org_roles where key='custom-temp'")).rows,
      ).toHaveLength(1);
      expect(
        (await client.query("select * from permission_rules where role_key='custom-temp'")).rows,
      ).toHaveLength(1);
    } finally {
      await client.exec('alter table doc_audit_log drop constraint role_audit_failure');
    }
    await deleteRoleAccessCatalog(locals, 'custom-temp');
    expect(
      (await client.query("select * from org_roles where key='custom-temp'")).rows,
    ).toHaveLength(0);
    expect(
      (await client.query("select * from permission_rules where role_key='custom-temp'")).rows,
    ).toHaveLength(0);
    expect(
      (await client.query("select * from doc_audit_log where op='role_delete'")).rows,
    ).toHaveLength(1);
  });

  it('previews Restore inherited from current parent and section rules rather than empty code defaults', async () => {
    await write('section:abc123', 'deny');
    await write('page:def456', 'override', { caps: view });
    const page = (await readSectionAccess(locals, 'page:def456')).roles.find(
      (role) => role.key === 'viewer',
    )!;
    expect(page.effective.view).toBe(true);
    expect(page.defaults.view).toBe(false);
    await write('page:def456', 'inherit');
    expect(
      (await readSectionAccess(locals, 'page:def456')).roles.find((role) => role.key === 'viewer')
        ?.effective.view,
    ).toBe(false);
    await write('crm', 'deny');
    await write('crm.insights', 'override', { caps: view });
    const sub = (await readSectionAccess(locals, 'crm.insights')).roles.find(
      (role) => role.key === 'viewer',
    )!;
    expect(sub.effective.view).toBe(true);
    expect(sub.defaults.view).toBe(false);
  });

  it('does not adopt new simulated users:manage grants within an already admitted request', async () => {
    const admitted = {
      orgId: org,
      profileId: profile,
      generation: '30000000-0000-4000-8000-000000000001',
      rank: 60,
      invalid: false,
      roleKey: 'manager',
      capabilities: buildCapabilities(['manager'], []),
    };
    await expect(
      runWithEffectiveAuthority(admitted, () => readSectionAccess(locals, 'crm')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('preserves inherited record restrictions and field tier when creating a dotted action override', async () => {
    await client.query(
      "insert into permission_rules values ($1,'viewer','crm',true,false,false,false,false,false,true,1,now())",
      [org],
    );
    await write('crm.insights', 'override', { caps: view });
    const sub = (await readSectionAccess(locals, 'crm.insights')).roles.find(
      (role) => role.key === 'viewer',
    )!;
    expect(sub.effectiveIfOwner).toBe(true);
    expect(sub.effectiveFieldLevel).toBe(1);
    expect(sub.explicit?.fieldLevel).toBe(1);
    expect(
      (await readSectionAccess(locals, 'crm')).roles.find((role) => role.key === 'viewer')
        ?.explicit,
    ).toMatchObject({ ifOwner: true, fieldLevel: 1 });
  });
  it('revalidates membership and mutable target existence at save time', async () => {
    const old = await revision('section:abc123');
    await client.query('delete from app_nav_config where org_id=$1', [org]);
    await expect(
      writeSectionAccess(locals, {
        target: 'section:abc123',
        roleKey: 'viewer',
        revision: old,
        mode: 'deny',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await client.query(
      'delete from organization_members where organization_id=$1 and profile_id=$2',
      [org, profile],
    );
    await expect(readSectionAccess(locals, 'crm')).rejects.toMatchObject({ status: 403 });
  });
});
