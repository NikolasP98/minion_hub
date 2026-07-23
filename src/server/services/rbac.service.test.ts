import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal fake Supabase postgrest client — only the query shapes rbac.service
 * actually issues (select/eq/in/order/maybeSingle, insert, upsert w/
 * onConflict, delete, count-head select). Backs the `db` in-memory tables
 * below; reset per test in beforeEach.
 */
type FakeQueryError = { message: string };

const queryErrors: Record<string, FakeQueryError | undefined> = {};

function makeFakeSupabase(db: Record<string, Record<string, unknown>[]>) {
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let mode: 'select' | 'insert' | 'upsert' | 'delete' | null = null;
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    let onConflict: string[] = [];
    let countRequested = false;

    async function run(): Promise<{ data: unknown; error: FakeQueryError | null; count?: number }> {
      const queryError = queryErrors[table];
      if (queryError) return { data: null, error: queryError };
      const rows = (db[table] ??= []);
      if (mode === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload!];
        rows.push(...arr);
        return { data: arr, error: null };
      }
      if (mode === 'upsert') {
        const arr = Array.isArray(payload) ? payload : [payload!];
        for (const row of arr) {
          const idx = rows.findIndex((r) => onConflict.every((k) => r[k] === row[k]));
          if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
          else rows.push(row);
        }
        return { data: arr, error: null };
      }
      if (mode === 'delete') {
        db[table] = rows.filter((r) => !filters.every((f) => f(r)));
        return { data: [], error: null };
      }
      const filtered = rows.filter((r) => filters.every((f) => f(r)));
      return { data: filtered, error: null, count: countRequested ? filtered.length : undefined };
    }

    const api = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        mode ??= 'select';
        if (o?.count) countRequested = true;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      order() {
        return api;
      },
      insert(row: Record<string, unknown> | Record<string, unknown>[]) {
        mode = 'insert';
        payload = row;
        return api;
      },
      upsert(
        row: Record<string, unknown> | Record<string, unknown>[],
        o?: { onConflict?: string },
      ) {
        mode = 'upsert';
        payload = row;
        onConflict = (o?.onConflict ?? '').split(',').filter(Boolean);
        return api;
      },
      delete() {
        mode = 'delete';
        return api;
      },
      async maybeSingle() {
        const res = await run();
        if (res.error) return res;
        const arr = res.data as Record<string, unknown>[];
        return { data: arr[0] ?? null, error: null };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return run().then(resolve, reject);
      },
    };
    return api;
  }
  return { from: (t: string) => builder(t) };
}

const db: Record<string, Record<string, unknown>[]> = {};
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => makeFakeSupabase(db) }));

function seedSystemCatalog() {
  db.permission_roles = [
    { key: 'owner', name: 'Owner', rank: 100, description: null, is_system: true },
    { key: 'admin', name: 'Admin', rank: 80, description: null, is_system: true },
    { key: 'manager', name: 'Manager', rank: 60, description: null, is_system: true },
    { key: 'staff', name: 'Staff', rank: 40, description: null, is_system: true },
    { key: 'viewer', name: 'Viewer', rank: 20, description: null, is_system: true },
  ];
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(queryErrors)) delete queryErrors[k];
  seedSystemCatalog();
  db.org_roles = [];
  db.permission_rules = [];
  db.member_roles = [];
});

import {
  buildCapabilities,
  defaultCaps,
  legacyRoleKey,
  apiWriteCapability,
  normalizeViewDependency,
  wouldRemoveLastOwner,
  listRoleCatalog,
  createCustomRole,
  deleteCustomRole,
  isAssignableRoleKey,
  resolveCapabilities,
} from './rbac.service';

const ROW = (over: Record<string, unknown>) => ({
  role_key: 'viewer',
  module: 'crm',
  can_view: false,
  can_create: false,
  can_edit: false,
  can_delete: false,
  can_export: false,
  can_manage: false,
  ...over,
});

describe('defaultCaps — role tiers', () => {
  test('owner/admin get everything', () => {
    for (const r of ['owner', 'admin']) {
      expect(defaultCaps(r, 'crm').delete).toBe(true);
      expect(defaultCaps(r, 'settings').manage).toBe(true);
    }
  });
  test('manager: full business data, no delete/manage; admin modules view-only', () => {
    expect(defaultCaps('manager', 'finance').export).toBe(true);
    expect(defaultCaps('manager', 'finance').delete).toBe(false);
    expect(defaultCaps('manager', 'settings').view).toBe(true);
    expect(defaultCaps('manager', 'settings').manage).toBe(false);
  });
  test('staff: edit on crm/scheduling/support/comms, read-only finance/sales', () => {
    expect(defaultCaps('staff', 'crm').edit).toBe(true);
    expect(defaultCaps('staff', 'finance').edit).toBe(false);
    expect(defaultCaps('staff', 'finance').view).toBe(true);
    expect(defaultCaps('staff', 'settings').view).toBe(false);
  });
  test('viewer: read business only', () => {
    expect(defaultCaps('viewer', 'crm').view).toBe(true);
    expect(defaultCaps('viewer', 'crm').edit).toBe(false);
    expect(defaultCaps('viewer', 'settings').view).toBe(false);
  });
  test('overview is viewable by every role; unknown role fails closed', () => {
    expect(defaultCaps('viewer', 'overview').view).toBe(true);
    expect(defaultCaps('nonsense', 'crm').view).toBe(false);
  });
  test('pos: staff has create+edit but not manage; viewer is view-only', () => {
    const staff = defaultCaps('staff', 'pos');
    expect(staff.view).toBe(true);
    expect(staff.create).toBe(true);
    expect(staff.edit).toBe(true);
    expect(staff.manage).toBe(false);
    expect(staff.delete).toBe(false);
    const viewer = defaultCaps('viewer', 'pos');
    expect(viewer.view).toBe(true);
    expect(viewer.create).toBe(false);
    expect(viewer.edit).toBe(false);
    expect(viewer.manage).toBe(false);
  });
  test('pos: manager gets manage (unlike other business modules), still no delete', () => {
    const manager = defaultCaps('manager', 'pos');
    expect(manager.manage).toBe(true);
    expect(manager.delete).toBe(false);
    expect(manager.export).toBe(true);
  });
  test('tools (Tool Studio): owner/admin manage, manager view-only, staff/viewer none — same tier as flows/marketplace', () => {
    expect(defaultCaps('owner', 'tools').manage).toBe(true);
    expect(defaultCaps('admin', 'tools').manage).toBe(true);
    expect(defaultCaps('manager', 'tools').view).toBe(true);
    expect(defaultCaps('manager', 'tools').manage).toBe(false);
    expect(defaultCaps('staff', 'tools').view).toBe(false);
    expect(defaultCaps('viewer', 'tools').view).toBe(false);
    // Matches flows/marketplace exactly (both ADMIN_MODULES entries).
    expect(defaultCaps('manager', 'tools')).toEqual(defaultCaps('manager', 'flows'));
  });
});

describe('buildCapabilities — multi-role OR + overrides', () => {
  test('roles OR together (viewer+staff → staff can edit crm)', () => {
    const caps = buildCapabilities(['viewer', 'staff'], []);
    expect(caps.can('crm', 'edit')).toBe(true);
    expect(caps.can('finance', 'edit')).toBe(false);
  });
  test('canRunAnalytics true for any role with a business view; false with no roles', () => {
    expect(buildCapabilities(['viewer'], []).canRunAnalytics()).toBe(true);
    const none = buildCapabilities([], []);
    expect(none.canRunAnalytics()).toBe(false);
    expect(none.can('crm', 'view')).toBe(false);
  });
  test('per-org override beats the code default', () => {
    const caps = buildCapabilities(
      ['staff'],
      [
        {
          role_key: 'staff',
          module: 'finance',
          can_view: true,
          can_create: false,
          can_edit: true, // override: staff normally cannot edit finance
          can_delete: false,
          can_export: false,
          can_manage: false,
        },
      ],
    );
    expect(caps.can('finance', 'edit')).toBe(true);
  });
  test('visibleModules reflects view caps', () => {
    const caps = buildCapabilities(['viewer'], []);
    expect(caps.visibleModules()).toContain('crm');
    expect(caps.visibleModules()).not.toContain('settings');
  });
});

describe('legacyRoleKey — back-compat mapping', () => {
  test('owner/admin pass through; member→manager; unknown→viewer', () => {
    expect(legacyRoleKey('owner')).toBe('owner');
    expect(legacyRoleKey('admin')).toBe('admin');
    expect(legacyRoleKey('member')).toBe('manager');
    expect(legacyRoleKey(null)).toBe('viewer');
  });
});

describe('resolveCapabilities — fail-closed role authority', () => {
  test('rejects a returned member_roles query error instead of falling back', async () => {
    queryErrors.member_roles = { message: 'member roles unavailable' };
    db.organization_members = [{ organization_id: 'org1', profile_id: 'p1', role: 'owner' }];

    await expect(resolveCapabilities('org1', 'p1')).rejects.toThrow(
      'Failed to resolve member role assignments',
    );
  });

  test('rejects a returned legacy membership query error instead of minting viewer', async () => {
    queryErrors.organization_members = { message: 'legacy membership unavailable' };

    await expect(resolveCapabilities('org1', 'p1')).rejects.toThrow(
      'Failed to resolve legacy organization membership',
    );
  });

  test('rejects a returned permission_rules query error', async () => {
    db.member_roles = [{ org_id: 'org1', profile_id: 'p1', role_key: 'staff' }];
    queryErrors.permission_rules = { message: 'permission rules unavailable' };

    await expect(resolveCapabilities('org1', 'p1')).rejects.toThrow(
      'Failed to resolve role permission rules',
    );
  });

  test('does not invent viewer authority when no membership exists', async () => {
    expect((await resolveCapabilities('org1', 'p1')).roles).toEqual([]);
  });

  test('preserves viewer fallback for a present legacy membership with a null role', async () => {
    db.organization_members = [{ organization_id: 'org1', profile_id: 'p1', role: null }];

    expect((await resolveCapabilities('org1', 'p1')).roles).toEqual(['viewer']);
  });
});

describe('sub-resource inheritance + view-dependency', () => {
  test('sub-resource inherits parent caps when no explicit override', () => {
    // viewer default: crm = VIEW only → crm.insights inherits VIEW
    const caps = buildCapabilities(['viewer'], []);
    expect(caps.can('crm.insights', 'view')).toBe(true);
    expect(caps.can('crm.insights', 'edit')).toBe(false);
  });
  test('explicit sub-resource override wins over parent', () => {
    // parent crm has view; sub crm.insights explicitly denied view
    const caps = buildCapabilities(['viewer'], [ROW({ module: 'crm.insights', can_view: false })]);
    expect(caps.can('crm', 'view')).toBe(true); // parent default still view
    expect(caps.can('crm.insights', 'view')).toBe(false); // sub overridden off
  });
  test('parent override propagates to inheriting sub-resources', () => {
    // give viewer full crm via override → crm.cleanup (no own override) inherits it
    const caps = buildCapabilities(
      ['viewer'],
      [ROW({ module: 'crm', can_view: true, can_edit: true })],
    );
    expect(caps.can('crm.cleanup', 'edit')).toBe(true);
  });
  test('normalizeViewDependency: view off clears all; view on untouched', () => {
    const offWithExtras = {
      view: false,
      create: true,
      edit: true,
      delete: false,
      export: false,
      manage: false,
    };
    expect(normalizeViewDependency(offWithExtras)).toEqual({
      view: false,
      create: false,
      edit: false,
      delete: false,
      export: false,
      manage: false,
    });
    const onSet = {
      view: true,
      create: true,
      edit: false,
      delete: false,
      export: false,
      manage: false,
    };
    expect(normalizeViewDependency(onSet)).toBe(onSet);
  });
});

describe('ownerScoped — record-level (if-owner)', () => {
  test('a role restricted with if_owner is owner-scoped on that module', () => {
    const caps = buildCapabilities(
      ['viewer'],
      [ROW({ module: 'crm', can_view: true, if_owner: true })],
    );
    expect(caps.can('crm', 'view')).toBe(true);
    expect(caps.ownerScoped('crm')).toBe(true);
  });
  test('no if_owner → full visibility (not scoped)', () => {
    const caps = buildCapabilities(['viewer'], []); // viewer default crm = VIEW, no if_owner
    expect(caps.ownerScoped('crm')).toBe(false);
  });
  test('least-restrictive wins: any role with un-restricted view lifts the scope', () => {
    // staff restricted-to-own on crm, but manager grants un-restricted crm view
    const caps = buildCapabilities(
      ['staff', 'manager'],
      [ROW({ role_key: 'staff', module: 'crm', can_view: true, if_owner: true })],
    );
    expect(caps.ownerScoped('crm')).toBe(false);
  });
  test('not scoped when the role cannot view at all', () => {
    const caps = buildCapabilities(
      ['viewer'],
      [ROW({ module: 'finance', can_view: false, if_owner: true })],
    );
    expect(caps.ownerScoped('finance')).toBe(false);
  });
});

describe('fieldLevel — field-level (sensitive field) tier', () => {
  test('default is 1 (visible) for modules with a sensitive tier', () => {
    const caps = buildCapabilities(['viewer'], []);
    expect(caps.fieldLevel('crm')).toBe(1);
    expect(caps.fieldLevel('finance')).toBe(1);
    // modules without a sensitive tier → 0
    expect(caps.fieldLevel('agents')).toBe(0);
  });
  test('an override can lower a role below the sensitive threshold (mask)', () => {
    const caps = buildCapabilities(
      ['viewer'],
      [ROW({ module: 'crm', can_view: true, field_level: 0 })],
    );
    expect(caps.fieldLevel('crm')).toBe(0); // PII masked
  });
  test('MAX across roles — least-restrictive wins', () => {
    const caps = buildCapabilities(
      ['staff', 'manager'],
      [
        ROW({ role_key: 'staff', module: 'crm', can_view: true, field_level: 0 }),
        ROW({ role_key: 'manager', module: 'crm', can_view: true, field_level: 1 }),
      ],
    );
    expect(caps.fieldLevel('crm')).toBe(1);
  });
});

describe('wouldRemoveLastOwner — multi-role last-owner guard', () => {
  test('blocks removing owner from the sole owner', () => {
    expect(wouldRemoveLastOwner(['p1'], 'p1', 'owner')).toBe(true);
  });
  test('allows removing owner when another owner remains', () => {
    expect(wouldRemoveLastOwner(['p1', 'p2'], 'p1', 'owner')).toBe(false);
  });
  test('ignores non-owner role removals entirely', () => {
    expect(wouldRemoveLastOwner(['p1'], 'p1', 'manager')).toBe(false);
  });
  test('no-op when the profile is not an owner in the first place', () => {
    expect(wouldRemoveLastOwner(['p2'], 'p1', 'owner')).toBe(false);
  });
});

describe('apiWriteCapability — central hooks write guard mapping', () => {
  test('reads are never gated here', () => {
    expect(apiWriteCapability('/api/crm/contacts', 'GET')).toBeNull();
    expect(apiWriteCapability('/api/crm/contacts', 'HEAD')).toBeNull();
  });
  test('business writes map to (module, edit); DELETE→delete', () => {
    expect(apiWriteCapability('/api/crm/contacts', 'POST')).toEqual({
      module: 'crm',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/crm/contacts/abc', 'PATCH')).toEqual({
      module: 'crm',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/crm/tags/abc', 'DELETE')).toEqual({
      module: 'crm',
      action: 'delete',
    });
    expect(apiWriteCapability('/api/finances/products', 'PUT')).toEqual({
      module: 'finance',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/sales/orders/x', 'PATCH')).toEqual({
      module: 'sales',
      action: 'edit',
    });
  });
  test('brain search is a read operation even though its query body uses POST', () => {
    expect(
      apiWriteCapability('/api/brains/11111111-1111-4111-8111-111111111111/search', 'POST'),
    ).toEqual({
      module: 'brains',
      action: 'view',
    });
    expect(apiWriteCapability('/api/brains/11111111-1111-4111-8111-111111111111', 'POST')).toEqual({
      module: 'brains',
      action: 'edit',
    });
  });
  test('work + workforce map to projects (no /api/work ↔ /api/workforce collision)', () => {
    expect(apiWriteCapability('/api/work/reassign', 'PATCH')).toEqual({
      module: 'projects',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/workforce/anything', 'POST')).toEqual({
      module: 'projects',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/workforce/factory-intake', 'POST')).toEqual({
      module: 'projects',
      action: 'edit',
    });
  });
  test('org-config surfaces require settings:manage', () => {
    expect(apiWriteCapability('/api/modules', 'PUT')).toEqual({
      module: 'settings',
      action: 'manage',
    });
    expect(apiWriteCapability('/api/plugins/whatsapp/toggle', 'POST')).toEqual({
      module: 'settings',
      action: 'manage',
    });
  });
  test('builder writes map agents/skills and tools to their owning modules', () => {
    expect(apiWriteCapability('/api/builder/agents', 'POST')).toEqual({
      module: 'agents',
      action: 'create',
    });
    expect(apiWriteCapability('/api/builder/skills', 'POST')).toEqual({
      module: 'agents',
      action: 'create',
    });
    expect(apiWriteCapability('/api/builder/skills/s1', 'DELETE')).toEqual({
      module: 'agents',
      action: 'delete',
    });
    expect(apiWriteCapability('/api/builder/agent-skills', 'POST')).toEqual({
      module: 'agents',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/builder/tools', 'POST')).toEqual({
      module: 'tools',
      action: 'create',
    });
    expect(apiWriteCapability('/api/builder/tools/t1', 'PUT')).toEqual({
      module: 'tools',
      action: 'edit',
    });
  });
  test('anonymous public booking is excluded', () => {
    expect(apiWriteCapability('/api/scheduling/public/my-slug/book', 'POST')).toBeNull();
  });
  test('ungated prefixes return null', () => {
    expect(apiWriteCapability('/api/agents/x', 'POST')).toBeNull();
    expect(apiWriteCapability('/api/gateway/query', 'POST')).toBeNull();
    expect(apiWriteCapability('/api/messages/ingest', 'POST')).toBeNull();
  });
  test('pos writes map to (pos, edit); DELETE→delete', () => {
    expect(apiWriteCapability('/api/pos/tickets', 'POST')).toEqual({
      module: 'pos',
      action: 'edit',
    });
    expect(apiWriteCapability('/api/pos/tickets/x/void', 'DELETE')).toEqual({
      module: 'pos',
      action: 'delete',
    });
  });
});

describe('custom roles — capability resolution (buildCapabilities takes any role key)', () => {
  test('a custom-* key with its own override resolves like any role', () => {
    const caps = buildCapabilities(
      ['custom-senior-support'],
      [
        ROW({
          role_key: 'custom-senior-support',
          module: 'support',
          can_view: true,
          can_edit: true,
        }),
      ],
    );
    expect(caps.can('support', 'edit')).toBe(true);
    expect(caps.can('finance', 'view')).toBe(false); // no override + unknown-role default is NONE
  });
});

describe('org-roles — catalog union', () => {
  test("listRoleCatalog unions system roles with this org's custom roles, ranked", () => {
    db.org_roles = [
      {
        org_id: 'org1',
        key: 'custom-senior-support',
        name: 'Senior Support',
        rank: 40,
        source_role_key: 'staff',
      },
    ];
    return listRoleCatalog('org1').then((cat) => {
      // Same rank (40) as staff — stable sort keeps system-catalog order for ties.
      expect(cat.map((c) => c.key)).toEqual([
        'owner',
        'admin',
        'manager',
        'staff',
        'custom-senior-support',
        'viewer',
      ]);
      expect(cat.find((c) => c.key === 'custom-senior-support')?.isCustom).toBe(true);
    });
  });
  test("a different org does not see this org's custom role", async () => {
    db.org_roles = [
      {
        org_id: 'org1',
        key: 'custom-senior-support',
        name: 'Senior Support',
        rank: 40,
        source_role_key: 'staff',
      },
    ];
    const cat = await listRoleCatalog('org2');
    expect(cat.some((c) => c.key === 'custom-senior-support')).toBe(false);
  });
});

describe('isAssignableRoleKey', () => {
  test('system keys are always assignable', async () => {
    expect(await isAssignableRoleKey('org1', 'staff')).toBe(true);
  });
  test('a custom key is assignable only in the org that owns it', async () => {
    db.org_roles = [
      { org_id: 'org1', key: 'custom-x', name: 'X', rank: 40, source_role_key: 'staff' },
    ];
    expect(await isAssignableRoleKey('org1', 'custom-x')).toBe(true);
    expect(await isAssignableRoleKey('org2', 'custom-x')).toBe(false);
  });
  test('unknown / non-string keys are rejected', async () => {
    expect(await isAssignableRoleKey('org1', 'nonsense')).toBe(false);
    expect(await isAssignableRoleKey('org1', undefined)).toBe(false);
  });
});

describe('createCustomRole — clone-copies-rules', () => {
  test("clones the source role's effective per-module matrix into permission_rules for the new key", async () => {
    // Caller is a platform admin (uncapped) — the rank cap is exercised separately below.
    db.profiles = [{ id: 'user1', role: 'admin' }];
    // staff has an org override on finance (normally view-only by default).
    db.permission_rules = [
      {
        org_id: 'org1',
        role_key: 'staff',
        module: 'finance',
        can_view: true,
        can_create: false,
        can_edit: true,
        can_delete: false,
        can_export: false,
        can_manage: false,
        if_owner: false,
        field_level: 1,
      },
    ];
    const role = await createCustomRole(
      'org1',
      { sourceRoleKey: 'staff', name: 'Senior Support' },
      'user1',
    );
    expect(role.key).toBe('custom-senior-support');
    expect(role.rank).toBe(40); // same rank as staff

    const orgRole = db.org_roles.find((r) => r.key === 'custom-senior-support');
    expect(orgRole?.source_role_key).toBe('staff');
    expect(orgRole?.created_by).toBe('user1');

    const rules = db.permission_rules.filter((r) => r.role_key === 'custom-senior-support');
    // One row per MODULE — the clone is total, not just the overridden ones.
    expect(rules.length).toBeGreaterThan(10);
    const finance = rules.find((r) => r.module === 'finance');
    expect(finance?.can_edit).toBe(true); // copied the override, not the staff default
    const crm = rules.find((r) => r.module === 'crm');
    expect(crm?.can_edit).toBe(true); // staff default for crm (no override) was cloned too
  });

  test('rejects an unknown sourceRoleKey', async () => {
    await expect(
      createCustomRole('org1', { sourceRoleKey: 'nonsense', name: 'X' }, null),
    ).rejects.toThrow();
  });

  test('rejects a duplicate name/key', async () => {
    await createCustomRole('org1', { sourceRoleKey: 'staff', name: 'Senior Support' }, null, true);
    await expect(
      createCustomRole('org1', { sourceRoleKey: 'staff', name: 'Senior Support' }, null, true),
    ).rejects.toThrow();
  });

  test('no self-escalation: an org admin cannot clone a higher-ranked owner role', async () => {
    // admin-user is an org admin (rank 80); owner is rank 100.
    db.profiles = [{ id: 'admin-user', role: 'user' }];
    db.member_roles = [{ org_id: 'org1', profile_id: 'admin-user', role_key: 'admin' }];
    await expect(
      createCustomRole('org1', { sourceRoleKey: 'owner', name: 'Sneaky Owner' }, 'admin-user'),
    ).rejects.toMatchObject({ status: 403 });
    // and cloning at/below their own rank still works
    const ok = await createCustomRole(
      'org1',
      { sourceRoleKey: 'manager', name: 'Team Lead' },
      'admin-user',
    );
    expect(ok.key).toBe('custom-team-lead');
  });

  test('fails closed: a null caller without system=true is rejected (no fail-open escalation)', async () => {
    // A missing HTTP caller id must NOT be treated as a trusted system caller.
    await expect(
      createCustomRole('org1', { sourceRoleKey: 'staff', name: 'Nulled' }, null),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('deleteCustomRole — in-use guard', () => {
  test('refuses to delete while a member still holds the role', async () => {
    await createCustomRole('org1', { sourceRoleKey: 'staff', name: 'Senior Support' }, null, true);
    db.member_roles = [{ org_id: 'org1', profile_id: 'p1', role_key: 'custom-senior-support' }];
    await expect(deleteCustomRole('org1', 'custom-senior-support')).rejects.toThrow();
    expect(db.org_roles.some((r) => r.key === 'custom-senior-support')).toBe(true);
  });
  test('deletes the role + its permission_rules once unassigned', async () => {
    await createCustomRole('org1', { sourceRoleKey: 'staff', name: 'Senior Support' }, null, true);
    await deleteCustomRole('org1', 'custom-senior-support');
    expect(db.org_roles.some((r) => r.key === 'custom-senior-support')).toBe(false);
    expect(db.permission_rules.some((r) => r.role_key === 'custom-senior-support')).toBe(false);
  });
  test('404s for a key this org never created', async () => {
    await expect(deleteCustomRole('org1', 'custom-ghost')).rejects.toThrow();
  });
});
