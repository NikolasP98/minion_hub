import { roleFitsActualAuthority } from './role-simulation-policy';
import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import { currentEffectiveAuthority } from '$server/auth/effective-authority';
import { normalizeNavConfig, type NavConfig } from '$lib/nav/custom-sections';
import { decideRouteAccess } from '$lib/routes/route-access-policies';
import { capsToLegacyPermissions } from './permissions.service';
import {
  MODULES,
  ACTIONS,
  buildCapabilities,
  defaultFieldLevel,
  resolveMemberRoleKeys,
  invalidateRbac,
  type Capabilities,
  type CapabilityOverrideRow,
  type RoleCatalogEntry,
} from './rbac.service';
import {
  MAX_ORGANIZATION_ROLES,
  parseOrganizationRolePolicy,
  rolePolicyRevision,
  type OrganizationRolePolicy,
} from './organization-role-policy';
import {
  getRoleTemplate,
  roleTemplates,
  templateCaps,
  type RoleTemplateId,
} from './role-templates';

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;
export interface AdminRole extends Row {
  key: string;
  name: string;
  rank: number;
}
export interface AdminMember extends Row {
  profile_id: string;
  role: string | null;
  profile_role: string | null;
}
export interface AdminAssignment extends Row {
  profile_id: string;
  role_key: string;
}
export interface OrganizationAdminState {
  policy: OrganizationRolePolicy;
  roles: AdminRole[];
  rules: (CapabilityOverrideRow & Row)[];
  members: AdminMember[];
  assignments: AdminAssignment[];
  nav: NavConfig;
}
export async function readOrganizationAdminState(
  tx: Tx,
  orgId: string,
): Promise<OrganizationAdminState> {
  const [org] = await tx<Array<{ role_model: string | null; default_role_key: string | null }>>`
    select to_jsonb(o)->>'role_model' as role_model,to_jsonb(o)->>'default_role_key' as default_role_key
    from public.organizations o where id=${orgId}::uuid and status='active' for share`;
  const policy = parseOrganizationRolePolicy(org);
  const local = await tx<
    AdminRole[]
  >`select key,name,rank from public.org_roles where org_id=${orgId} for share`;
  const system =
    policy.roleModel === 'legacy'
      ? await tx<AdminRole[]>`select key,name,rank from public.permission_roles for share`
      : [];
  const rules = await tx<
    Array<CapabilityOverrideRow & Row>
  >`select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from public.permission_rules where org_id=${orgId}::uuid order by role_key,module for share`;
  const members = await tx<
    AdminMember[]
  >`select m.profile_id::text,m.role,p.role as profile_role from public.organization_members m join public.profiles p on p.id=m.profile_id where m.organization_id=${orgId}::uuid and (${policy.roleModel}='legacy' or not coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false)) for share of m,p`;
  const assignments = await tx<
    AdminAssignment[]
  >`select profile_id::text,role_key from public.member_roles where org_id=${orgId}::uuid for share`;
  const [nav] = await tx<
    Array<{ value: unknown }>
  >`select value from public.app_nav_config where org_id=${orgId} for share`;
  return {
    policy,
    roles: [...system, ...local],
    rules: [...rules],
    members: [...members],
    assignments: [...assignments],
    nav: normalizeNavConfig(nav?.value),
  };
}
export function memberAuthority(
  state: OrganizationAdminState,
  profileId: string,
): { caps: Capabilities; rank: number; platformAdmin: boolean } {
  const member = state.members.find((m) => m.profile_id === profileId);
  if (!member) throw error(403, 'Organization membership required');
  const keys = resolveMemberRoleKeys(
    state.assignments.filter((a) => a.profile_id === profileId).map((a) => a.role_key),
    member.role,
    state.policy.roleModel,
    state.roles.map((r) => r.key),
  );
  return {
    caps: buildCapabilities(keys, state.rules),
    rank: Math.max(0, ...state.roles.filter((r) => keys.includes(r.key)).map((r) => r.rank)),
    platformAdmin: member.profile_role === 'admin',
  };
}
function pageAllowed(caps: Capabilities, nav: NavConfig, path: string): boolean {
  const perms = new Set(capsToLegacyPermissions(caps));
  const native =
    caps.explicitView(`page:${path}`) ??
    decideRouteAccess(path, {
      authenticated: true,
      role: 'user',
      permissions: perms,
      orgCapabilities: perms,
    }).allowed;
  if (!native) return false;
  const pages = [
    ...nav.sections.flatMap((section) =>
      section.pages.map((page) => ({ page, sectionKey: `section:${section.id}` })),
    ),
    ...Object.values(nav.builtinSections)
      .flat()
      .map((page) => ({ page, sectionKey: null })),
  ];
  for (const { page, sectionKey } of pages.filter(
    (p) => p.page.target === path && p.page.kind === 'main',
  )) {
    const allowed =
      caps.explicitView(`page:${page.id}`) ??
      (sectionKey ? caps.explicitView(sectionKey) : undefined) ??
      native;
    if (!allowed) return false;
  }
  return true;
}
/** Post-change proof shared by role, permission and membership writers. Legacy is untouched. */
export function hasRecoverableOrganizationAdministrator(state: OrganizationAdminState): boolean {
  if (state.policy.roleModel === 'legacy') return true;
  const maxRank = Math.max(0, ...state.roles.map((r) => r.rank));
  return state.members.some((member) => {
    const a = memberAuthority(state, member.profile_id);
    return (
      a.platformAdmin ||
      (a.caps.can('users', 'manage') &&
        a.caps.can('roles', 'view') &&
        a.caps.can('roles', 'edit') &&
        a.rank >= maxRank &&
        pageAllowed(a.caps, state.nav, '/settings/roles') &&
        pageAllowed(a.caps, state.nav, '/settings/team'))
    );
  });
}
export async function assertOrganizationAccessRecoverable(tx: Tx, orgId: string): Promise<void> {
  const state = await readOrganizationAdminState(tx, orgId);
  if (state.policy.roleModel === 'legacy') return;
  if (!state.members.some((m) => m.role === 'owner'))
    throw error(409, 'An organization owner must remain');
  if (!hasRecoverableOrganizationAdministrator(state))
    throw error(409, 'An administrator able to manage organization access must remain');
}
function revision(state: OrganizationAdminState): string {
  return rolePolicyRevision(state.policy, state.roles, state.rules);
}
function requireRevision(state: OrganizationAdminState, value: string) {
  if (revision(state) !== value)
    throw error(409, 'Organization roles changed. Reload to continue.');
}
function actor(locals: App.Locals): { orgId: string; profileId: string } {
  const orgId = locals.tenantCtx?.tenantId,
    profileId = locals.user?.supabaseId;
  if (!orgId || !profileId) throw error(401, 'Authenticated organization actor required');
  return { orgId, profileId };
}
function requireActor(
  state: OrganizationAdminState,
  orgId: string,
  profileId: string,
  operation: 'create' | 'edit' | 'delete' | 'assign' = 'assign',
): ReturnType<typeof memberAuthority> {
  const a = memberAuthority(state, profileId);
  const simulation = currentEffectiveAuthority(orgId, profileId);
  if (simulation?.invalid) throw error(403, 'Access management unavailable');
  const module = operation === 'assign' ? 'users' : 'roles';
  const action = operation === 'assign' ? 'manage' : operation;
  if (!a.platformAdmin && !a.caps.can(module, action))
    throw error(403, `${module}:${action} required`);
  if (simulation && !simulation.capabilities.can(module, action))
    throw error(403, `${module}:${action} required`);
  return {
    ...a,
    rank: Math.min(
      a.platformAdmin ? Number.MAX_SAFE_INTEGER : a.rank,
      simulation?.rank ?? Number.MAX_SAFE_INTEGER,
    ),
    platformAdmin: a.platformAdmin && !simulation,
  };
}
function assertGrant(
  a: ReturnType<typeof memberAuthority>,
  rank: number,
  caps: Capabilities,
  targets: readonly string[],
  orgId: string,
  profileId: string,
  state: OrganizationAdminState,
) {
  if (rank > a.rank && !a.platformAdmin) throw error(403, 'Cannot grant a role above your rank');
  const simulation = currentEffectiveAuthority(orgId, profileId);
  for (const authority of [a.platformAdmin ? null : a.caps, simulation?.capabilities ?? null]) {
    if (!authority) continue;
    if (
      !roleFitsActualAuthority({
        actual: authority,
        selected: caps,
        rules: state.rules,
        nav: state.nav,
        platformAdmin: false,
      })
    )
      throw error(403, 'Cannot grant access beyond your complete authority');
    for (const target of targets) {
      for (const action of ACTIONS)
        if (caps.can(target, action) && !authority.can(target, action))
          throw error(403, 'Cannot grant access beyond your authority');
      if (caps.can(target, 'view') && authority.ownerScoped(target) && !caps.ownerScoped(target))
        throw error(403, 'Cannot grant unrestricted records');
      if (caps.can(target, 'view') && caps.fieldLevel(target) > authority.fieldLevel(target))
        throw error(403, 'Cannot grant sensitive fields beyond your authority');
      if (
        (target.startsWith('page:') || target.startsWith('section:')) &&
        caps.explicitView(target) === true &&
        authority.explicitView(target) === false
      )
        throw error(403, 'Cannot grant denied page access');
    }
  }
}
type AuditJson = null | boolean | number | string | AuditJson[] | { [key: string]: AuditJson };
function auditJson(value: unknown): AuditJson {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(auditJson);
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, auditJson(item)]));
  throw new Error('Unsupported role audit value');
}
async function audit(
  tx: Tx,
  orgId: string,
  profileId: string,
  field: string,
  old: unknown,
  next: unknown,
) {
  const id = randomUUID();
  // Drizzle replaces this shared pool's JSON serializers; send text before casting.
  await tx`insert into public.doc_audit_log(id,org_id,ref_type,ref_id,actor_id,op,changes) values(${id}::uuid,${orgId},'role_configuration',${id}::uuid,${profileId}::uuid,'permission',${JSON.stringify(auditJson([{ field, old, new: next }]))}::text::jsonb)`;
}
export type CreateOrganizationRoleInput =
  | { name: string; source: 'template'; templateId: RoleTemplateId; templateVersion: number }
  | { name: string; source: 'blank' }
  | { name: string; source: 'duplicate'; sourceRoleKey: string };
export async function loadRoleSettings(orgId: string) {
  return getPgClient().begin('isolation level repeatable read', async (tx) => {
    const state = await readOrganizationAdminState(tx, orgId);
    return { ...state.policy, revision: revision(state), templates: roleTemplates() };
  });
}
export async function createOrganizationRole(
  locals: App.Locals,
  input: CreateOrganizationRoleInput,
): Promise<RoleCatalogEntry> {
  const { orgId, profileId } = actor(locals);
  const result = await getPgClient().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
    const state = await readOrganizationAdminState(tx, orgId),
      a = requireActor(state, orgId, profileId, 'create');
    if (state.policy.roleModel === 'organization' && state.roles.length >= MAX_ORGANIZATION_ROLES)
      throw error(
        400,
        `An organization supports at most ${MAX_ORGANIZATION_ROLES} roles, including Administrator.`,
      );
    const name = input.name.trim(),
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!name || name.length > 120 || !slug)
      throw error(400, 'A role name with letters or digits is required');
    const key = `custom-${slug}`;
    if (state.roles.some((r) => r.key === key || r.name.toLowerCase() === name.toLowerCase()))
      throw error(409, 'A role with that name already exists');
    let template: ReturnType<typeof getRoleTemplate> | null = null;
    if (input.source === 'template') {
      try {
        template = getRoleTemplate(input.templateId, input.templateVersion);
      } catch {
        throw error(400, 'Unknown role template version. Reload templates to continue.');
      }
    }
    const source =
      input.source === 'duplicate'
        ? state.roles.find((r) => r.key === input.sourceRoleKey)
        : undefined;
    if (input.source === 'duplicate' && !source) throw error(400, 'Unknown source role');
    const rank = template?.rank ?? source?.rank ?? 10;
    const sourceCaps = source ? buildCapabilities([source.key], state.rules) : null;
    const targets = [
      ...MODULES,
      ...(source
        ? state.rules
            .filter(
              (r) =>
                r.role_key === source.key &&
                !MODULES.includes(r.module as (typeof MODULES)[number]),
            )
            .map((r) => r.module)
        : []),
    ];
    const rows = targets.map((module) => {
      const caps = template
        ? templateCaps(template.id, module as (typeof MODULES)[number], template.version)
        : sourceCaps
          ? Object.fromEntries(ACTIONS.map((action) => [action, sourceCaps.can(module, action)]))
          : Object.fromEntries(ACTIONS.map((action) => [action, false]));
      return {
        org_id: orgId,
        role_key: key,
        module,
        ...Object.fromEntries(ACTIONS.map((action) => [`can_${action}`, caps[action]])),
        if_owner: sourceCaps?.ownerScoped(module) ?? false,
        field_level: sourceCaps?.fieldLevel(module) ?? defaultFieldLevel(module),
      };
    });
    const planned = buildCapabilities([key], rows as unknown as CapabilityOverrideRow[]);
    assertGrant(a, rank, planned, targets, orgId, profileId, state);
    await tx`insert into public.org_roles(org_id,key,name,rank,source_role_key,created_by,template_id,template_version) values(${orgId},${key},${name},${rank},${source?.key ?? template?.id ?? null},${profileId},${template?.id ?? null},${template?.version ?? null})`;
    await tx`insert into public.permission_rules ${tx(rows)}`;
    await assertOrganizationAccessRecoverable(tx, orgId);
    await audit(tx, orgId, profileId, 'role', null, {
      key,
      name,
      source: input.source,
      templateId: template?.id,
      templateVersion: template?.version,
    });
    return { key, name, rank, description: null, isCustom: true };
  });
  await invalidateRbac(orgId);
  return result;
}
export async function renameOrganizationRole(
  locals: App.Locals,
  key: string,
  input: { name: string; revision: string },
) {
  const { orgId, profileId } = actor(locals);
  const result = await getPgClient().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
    const state = await readOrganizationAdminState(tx, orgId),
      a = requireActor(state, orgId, profileId, 'edit');
    requireRevision(state, input.revision);
    const role = state.roles.find((r) => r.key === key);
    if (!role || !key.startsWith('custom-')) throw error(404, 'Local role not found');
    if (role.rank > a.rank && !a.platformAdmin)
      throw error(403, 'Cannot rename a role above your rank');
    const name = input.name.trim();
    if (!name || name.length > 120) throw error(400, 'Role name required');
    if (state.roles.some((r) => r.key !== key && r.name.toLowerCase() === name.toLowerCase()))
      throw error(409, 'A role with that name already exists');
    await tx`update public.org_roles set name=${name} where org_id=${orgId} and key=${key}`;
    await audit(tx, orgId, profileId, 'role.name', role.name, name);
    const after = await readOrganizationAdminState(tx, orgId);
    return { key, name, revision: revision(after) };
  });
  await invalidateRbac(orgId);
  return result;
}
export async function setDefaultOrganizationRole(
  locals: App.Locals,
  input: { roleKey: string; revision: string },
) {
  const { orgId, profileId } = actor(locals);
  const result = await getPgClient().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
    const state = await readOrganizationAdminState(tx, orgId),
      a = requireActor(state, orgId, profileId, 'edit');
    requireActor(state, orgId, profileId, 'assign');
    if (state.policy.roleModel !== 'organization')
      throw error(400, 'Legacy organization has no local default role');
    requireRevision(state, input.revision);
    const role = state.roles.find((r) => r.key === input.roleKey);
    if (!role) throw error(400, 'Unknown organization role');
    assertGrant(
      a,
      role.rank,
      buildCapabilities([role.key], state.rules),
      [...MODULES, ...state.rules.filter((r) => r.role_key === role.key).map((r) => r.module)],
      orgId,
      profileId,
      state,
    );
    await tx`update public.organizations set default_role_key=${role.key} where id=${orgId}::uuid`;
    await audit(tx, orgId, profileId, 'default_role_key', state.policy.defaultRoleKey, role.key);
    return {
      defaultRoleKey: role.key,
      revision: revision(await readOrganizationAdminState(tx, orgId)),
    };
  });
  await invalidateRbac(orgId);
  return result;
}
export async function mutateOrganizationMemberRoles(
  orgId: string,
  profileId: string,
  input: { mode: 'replace' | 'add' | 'remove'; roleKey: string },
  grantedBy: string | null,
  system = false,
) {
  if (!grantedBy && !system) throw error(403, 'Role grantor identity required');
  await getPgClient().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
    const state = await readOrganizationAdminState(tx, orgId);
    if (state.policy.roleModel !== 'organization') throw error(400, 'Local role model required');
    if (!state.members.some((m) => m.profile_id === profileId))
      throw error(403, 'Target membership required');
    const role = state.roles.find((r) => r.key === input.roleKey);
    if (!role) throw error(400, 'Unknown organization role');
    if (grantedBy) {
      const a = requireActor(state, orgId, grantedBy);
      assertGrant(
        a,
        role.rank,
        buildCapabilities([role.key], state.rules),
        [...MODULES, ...state.rules.filter((r) => r.role_key === role.key).map((r) => r.module)],
        orgId,
        grantedBy,
        state,
      );
    }
    const old = state.assignments.filter((r) => r.profile_id === profileId).map((r) => r.role_key);
    if (input.mode === 'replace')
      await tx`delete from public.member_roles where org_id=${orgId}::uuid and profile_id=${profileId}::uuid`;
    if (input.mode === 'remove')
      await tx`delete from public.member_roles where org_id=${orgId}::uuid and profile_id=${profileId}::uuid and role_key=${role.key}`;
    else
      await tx`insert into public.member_roles(org_id,profile_id,role_key,granted_by) values(${orgId}::uuid,${profileId}::uuid,${role.key},${grantedBy}::uuid) on conflict do nothing`;
    await assertOrganizationAccessRecoverable(tx, orgId);
    if (grantedBy) await audit(tx, orgId, grantedBy, 'member.roles', old, { profileId, ...input });
  });
  await invalidateRbac(orgId);
}
