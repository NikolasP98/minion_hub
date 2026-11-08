import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { lockNavigationPolicy } from './nav-policy-lock';
import type { CoreTx } from '$server/db/with-org-core';
import {
  currentEffectiveAuthority,
  narrowAdmittedCapabilities,
} from '$server/auth/effective-authority';
import {
  MODULES,
  ACTIONS,
  buildCapabilities,
  resolveMemberRoleKeys,
  normalizeViewDependency,
  OWNER_SCOPABLE_MODULES,
  invalidateRbac,
  type CapabilityOverrideRow,
  type Capabilities,
  type RbacRoleView,
} from './rbac.service';
import {
  ALL_SUBRESOURCES,
  FIELD_LEVEL_MODULES,
  MODULE_LABELS,
  MODULE_SUBRESOURCES,
} from '$lib/permissions';
import { capsToLegacyPermissions } from './permissions.service';
import {
  normalizeNavConfig,
  navPageKeys,
  sectionViewKey,
  aliasableTargets,
  floorApplies,
  moduleViewFloor,
  type NavConfig,
} from '$lib/nav/custom-sections';
import { decideRouteAccess } from '$lib/routes/route-access-policies';
import {
  sectionAccessWriteSchema,
  type SectionActionSet,
  type SectionAccessTarget,
  type SectionAccessWrite,
  type SectionAccessSnapshot,
  type SectionAccessReceipt,
} from '$lib/nav/section-access';

interface RoleRow extends Record<string, unknown> {
  key: string;
  name: string;
  rank: number;
  description: string | null;
  is_system: boolean;
  source_role_key: string | null;
}
interface RuleRow extends CapabilityOverrideRow, Record<string, unknown> {}
interface PolicyRows {
  orgName: string;
  roles: RoleRow[];
  rules: RuleRow[];
  nav: NavConfig;
}
interface PolicyActor {
  profileId: string;
  orgId: string;
  name: string | null;
}
interface ActorAuthority {
  real: Capabilities;
  effective: Capabilities;
  rank: number;
  platformAdmin: boolean;
}
export interface PolicyReset {
  target: string;
  revision: string;
}

const emptyCaps = (): SectionActionSet => ({
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
  manage: false,
});
const actionSet = (caps: Capabilities, target: string): SectionActionSet =>
  Object.fromEntries(ACTIONS.map((a) => [a, caps.can(target, a)])) as SectionActionSet;
const storedCaps = (row: CapabilityOverrideRow): SectionActionSet => ({
  view: row.can_view,
  create: row.can_create,
  edit: row.can_edit,
  delete: row.can_delete,
  export: row.can_export,
  manage: row.can_manage,
});
function actorFor(locals: App.Locals): PolicyActor {
  const profileId = locals.user?.supabaseId;
  const orgId = locals.tenantCtx?.tenantId;
  if (!profileId || !orgId)
    throw error(401, 'Active organization and authenticated profile required');
  return { profileId, orgId, name: locals.user?.displayName ?? locals.user?.email ?? null };
}

async function loadPolicyRows(tx: CoreTx, orgId: string): Promise<PolicyRows> {
  const [org] = await tx.execute<{ name: string } & Record<string, unknown>>(
    sql`select name from organizations where id=${orgId}::uuid and status='active'`,
  );
  if (!org) throw error(403, 'Active organization required');
  const systemRoles = await tx.execute<RoleRow>(sql`
    select key,name,rank,description,is_system,null::text as source_role_key from permission_roles for share
  `);
  const customRoles = await tx.execute<RoleRow>(sql`
    select key,name,rank,null::text as description,false as is_system,source_role_key
    from org_roles where org_id=${orgId}::uuid for share
  `);
  const roles = [...systemRoles, ...customRoles].sort(
    (a, b) => b.rank - a.rank || a.key.localeCompare(b.key),
  );
  const rules = await tx.execute<RuleRow>(sql`
    select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level
    from permission_rules where org_id=${orgId}::uuid order by role_key,module for share
  `);
  const [nav] = await tx.execute<{ value: unknown } & Record<string, unknown>>(
    sql`select value from app_nav_config where org_id=${orgId} for share`,
  );
  return {
    orgName: org.name,
    roles: [...roles],
    rules: [...rules],
    nav: normalizeNavConfig(nav?.value),
  };
}

function platformCapabilities(): Capabilities {
  const full = buildCapabilities(['owner'], []);
  return { ...full, fieldLevel: () => Number.MAX_SAFE_INTEGER, explicitView: () => true };
}
async function requireFreshPolicyActor(
  tx: CoreTx,
  actor: PolicyActor,
  rows: PolicyRows,
): Promise<ActorAuthority> {
  const [member] = await tx.execute<
    { role: string | null; profile_role: string | null } & Record<string, unknown>
  >(
    sql`select m.role,p.role as profile_role from organization_members m inner join profiles p on p.id=m.profile_id
        where m.organization_id=${actor.orgId}::uuid and m.profile_id=${actor.profileId}::uuid for share of m,p`,
  );
  if (!member) throw error(403, 'Organization membership required');
  const assigned = await tx.execute<{ role_key: string } & Record<string, unknown>>(
    sql`select role_key from member_roles where org_id=${actor.orgId}::uuid and profile_id=${actor.profileId}::uuid for share`,
  );
  const actualRoles = resolveMemberRoleKeys(
    assigned.map((r) => r.role_key),
    member.role,
  ).filter((key) => rows.roles.some((role) => role.key === key));
  const platformAdmin = member.profile_role === 'admin';
  const real = platformAdmin ? platformCapabilities() : buildCapabilities(actualRoles, rows.rules);
  const simulation = currentEffectiveAuthority(actor.orgId, actor.profileId);
  if (simulation?.invalid) throw error(403, 'Access management unavailable for this role');
  const effective = simulation
    ? narrowAdmittedCapabilities(
        buildCapabilities([simulation.roleKey], rows.rules),
        simulation.capabilities,
      )
    : real;
  if (!real.can('users', 'manage') || !effective.can('users', 'manage'))
    throw error(403, 'users: manage required');
  const ranks = actualRoles.map((key) => rows.roles.find((r) => r.key === key)?.rank ?? 0);
  const actualRank = platformAdmin ? Number.MAX_SAFE_INTEGER : Math.max(0, ...ranks);
  const selectedRank = simulation
    ? (rows.roles.find((r) => r.key === simulation.roleKey)?.rank ?? -1)
    : actualRank;
  return {
    real,
    effective,
    rank: Math.min(actualRank, selectedRank, simulation?.rank ?? actualRank),
    platformAdmin: platformAdmin && !simulation,
  };
}

/** Resolve identifiers against the current catalog; never accept a label as authority. */
export function resolveSectionAccessTarget(
  key: string,
  nav: NavConfig,
): SectionAccessTarget | null {
  const mod = MODULES.find((m) => m === key);
  if (mod)
    return {
      key,
      label: MODULE_LABELS[mod],
      kind: 'module',
      definition: { module: mod },
      ownerScopable: mod in OWNER_SCOPABLE_MODULES,
      fieldScopable: mod in FIELD_LEVEL_MODULES,
    };
  const sub = ALL_SUBRESOURCES.find((s) => s.key === key);
  if (sub)
    return {
      key,
      label: sub.label,
      kind: 'subresource',
      definition: { subresource: sub.key },
      ownerScopable: false,
      fieldScopable: false,
    };
  if (key.startsWith('section:')) {
    const section = nav.sections.find((s) => sectionViewKey(s) === key);
    return section
      ? {
          key,
          label: section.label,
          kind: 'section',
          definition: section,
          ownerScopable: false,
          fieldScopable: false,
        }
      : null;
  }
  if (key.startsWith('page:/')) {
    const pattern = key.slice(5);
    const screen = aliasableTargets().find((s) => s.pattern === pattern);
    return screen
      ? {
          key,
          label: screen.title,
          kind: 'page',
          definition: { pattern },
          ownerScopable: false,
          fieldScopable: false,
        }
      : null;
  }
  if (key.startsWith('page:')) {
    const pageId = key.slice(5);
    for (const section of nav.sections) {
      const page = section.pages.find((p) => p.id === pageId);
      if (page)
        return {
          key,
          label: page.label,
          kind: 'page',
          definition: { section: section.id, page },
          ownerScopable: false,
          fieldScopable: false,
        };
    }
    for (const [module, pages] of Object.entries(nav.builtinSections)) {
      const page = pages.find((p) => p.id === pageId);
      if (page)
        return {
          key,
          label: page.label,
          kind: 'page',
          definition: { module, page },
          ownerScopable: false,
          fieldScopable: false,
        };
    }
  }
  return null;
}

function viewAllowed(target: SectionAccessTarget, caps: Capabilities, rows: PolicyRows): boolean {
  if (target.kind === 'module' || target.kind === 'subresource')
    return caps.can(target.key, 'view');
  if (target.kind === 'section') return caps.explicitView(target.key) !== false;
  const page = navPageKeys(rows.nav).find((p) => p.key === target.key);
  const path = page?.target ?? target.key.slice(5);
  const permissions = new Set(capsToLegacyPermissions(caps));
  const allowed =
    caps.explicitView(target.key) ??
    (page?.sectionKey ? caps.explicitView(page.sectionKey) : undefined) ??
    decideRouteAccess(path, {
      authenticated: true,
      role: 'user',
      permissions,
      orgCapabilities: permissions,
    }).allowed;
  const floor = page && floorApplies(path) ? moduleViewFloor(path) : null;
  return allowed && (!floor || permissions.has(floor));
}
function effectiveActions(
  target: SectionAccessTarget,
  caps: Capabilities,
  rows: PolicyRows,
): SectionActionSet {
  return target.kind === 'module' || target.kind === 'subresource'
    ? actionSet(caps, target.key)
    : { ...emptyCaps(), view: viewAllowed(target, caps, rows) };
}
/** Preview Restore inherited using live parent/section/module rules, removing this cell only. */
function inheritedActions(
  target: SectionAccessTarget,
  roleKey: string,
  rows: PolicyRows,
): SectionActionSet {
  const inherited = {
    ...rows,
    rules: rows.rules.filter((row) => row.role_key !== roleKey || row.module !== target.key),
  };
  return effectiveActions(target, buildCapabilities([roleKey], inherited.rules), inherited);
}
function ruleFor(rows: PolicyRows, roleKey: string, target: string): RuleRow | null {
  return rows.rules.find((r) => r.role_key === roleKey && r.module === target) ?? null;
}
function canonicalRule(row: RuleRow | null): unknown {
  return row
    ? { caps: storedCaps(row), ifOwner: row.if_owner === true, fieldLevel: row.field_level ?? 0 }
    : null;
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  return value;
}
export function sectionPolicyRevision(
  orgId: string,
  target: SectionAccessTarget,
  role: RoleRow,
  rows: PolicyRows,
): string {
  const parent = target.key.includes('.') ? target.key.split('.')[0] : null;
  const inheritedSection =
    target.kind === 'page'
      ? navPageKeys(rows.nav).find((p) => p.key === target.key)?.sectionKey
      : null;
  const definition = {
    target: target.definition,
    inheritedSection: inheritedSection
      ? canonicalRule(ruleFor(rows, role.key, inheritedSection))
      : null,
    defaults: inheritedActions(target, role.key, rows),
    // With no explicit page/section rule, route policy inherits module and
    // subresource authority. A changed inherited policy must invalidate a draft.
    routeRules:
      target.kind === 'page'
        ? rows.rules
            .filter((rule) => rule.role_key === role.key && !/^(page|section):/.test(rule.module))
            .map((rule) => [rule.module, canonicalRule(rule)])
        : null,
  };
  return createHash('sha256')
    .update(
      JSON.stringify(
        stableValue([
          orgId,
          target.key,
          role.key,
          definition,
          role,
          canonicalRule(ruleFor(rows, role.key, target.key)),
          parent ? canonicalRule(ruleFor(rows, role.key, parent)) : null,
        ]),
      ),
    )
    .digest('hex');
}
function snapshotFor(
  orgId: string,
  target: SectionAccessTarget,
  rows: PolicyRows,
): SectionAccessSnapshot {
  return {
    target: target.key,
    label: target.label,
    kind: target.kind,
    orgName: rows.orgName,
    ownerScopable: target.ownerScopable,
    fieldScopable: target.fieldScopable,
    roles: rows.roles.map((role) => {
      const stored = ruleFor(rows, role.key, target.key);
      const caps = buildCapabilities([role.key], rows.rules);
      const inheritedRows = {
        ...rows,
        rules: rows.rules.filter((row) => row.role_key !== role.key || row.module !== target.key),
      };
      const inherited = buildCapabilities([role.key], inheritedRows.rules);
      return {
        key: role.key,
        name: role.name,
        protected: role.key === 'owner',
        defaults: inheritedActions(target, role.key, rows),
        effective: effectiveActions(target, caps, rows),
        effectiveIfOwner: caps.ownerScoped(target.key),
        inheritedIfOwner: inherited.ownerScoped(target.key),
        effectiveFieldLevel: caps.fieldLevel(target.key),
        inheritedFieldLevel: inherited.fieldLevel(target.key),
        explicit: stored
          ? {
              caps: storedCaps(stored),
              ifOwner: stored.if_owner === true,
              fieldLevel: stored.field_level ?? 0,
            }
          : null,
        revision: sectionPolicyRevision(orgId, target, role, rows),
      };
    }),
  };
}

export async function readSectionAccess(
  locals: App.Locals,
  key: string,
): Promise<SectionAccessSnapshot> {
  const actor = actorFor(locals);
  return getCoreDb().transaction(async (tx) => {
    const rows = await loadPolicyRows(tx, actor.orgId);
    await requireFreshPolicyActor(tx, actor, rows);
    const target = resolveSectionAccessTarget(key, rows.nav);
    if (!target) throw error(404, 'Access target no longer exists');
    return snapshotFor(actor.orgId, target, rows);
  });
}

function checkedMutation(
  input: SectionAccessWrite,
  target: SectionAccessTarget,
  row: RuleRow | null,
  inheritedFieldLevel: number,
): RuleRow | null {
  if (
    (input.ifOwner !== undefined && !target.ownerScopable) ||
    (input.fieldLevel !== undefined && !target.fieldScopable)
  )
    throw error(400, 'Scope is not supported for this target');
  if (input.mode === 'inherit') return null;
  const caps = input.mode === 'deny' ? emptyCaps() : normalizeViewDependency(input.caps!);
  if (
    (target.kind === 'section' || target.kind === 'page') &&
    ACTIONS.some((a) => a !== 'view' && caps[a])
  )
    throw error(400, 'Navigation targets accept view access only');
  return {
    role_key: input.roleKey,
    module: target.key,
    can_view: caps.view,
    can_create: caps.create,
    can_edit: caps.edit,
    can_delete: caps.delete,
    can_export: caps.export,
    can_manage: caps.manage,
    if_owner: target.ownerScopable
      ? (input.ifOwner ?? row?.if_owner ?? false)
      : (row?.if_owner ?? false),
    // A new dotted action override must not silently change an inherited
    // sensitive-field tier. Existing rows retain their explicit tier.
    field_level: input.fieldLevel ?? row?.field_level ?? inheritedFieldLevel,
  };
}
function replaceRule(
  rows: PolicyRows,
  key: string,
  role: string,
  next: RuleRow | null,
): PolicyRows {
  return {
    ...rows,
    rules: [
      ...rows.rules.filter((r) => r.module !== key || r.role_key !== role),
      ...(next ? [next] : []),
    ],
  };
}
function requireGrantCeiling(
  target: SectionAccessTarget,
  role: RoleRow,
  rows: PolicyRows,
  authority: ActorAuthority,
): void {
  if (role.rank > authority.rank) throw error(403, 'Cannot manage a role above your authority');
  const next = buildCapabilities([role.key], rows.rules);
  const proposed = effectiveActions(target, next, rows);
  for (const cap of [authority.real, authority.effective]) {
    const held = effectiveActions(target, cap, rows);
    if (ACTIONS.some((a) => proposed[a] && !held[a]))
      throw error(403, 'Cannot grant access beyond your authority');
    if (proposed.view && cap.ownerScoped(target.key) && !next.ownerScoped(target.key))
      throw error(403, 'Cannot grant unrestricted records beyond your authority');
    if (proposed.view && next.fieldLevel(target.key) > cap.fieldLevel(target.key))
      throw error(403, 'Cannot grant sensitive fields beyond your authority');
  }
}
function affectedRegisteredTargets(targets: readonly SectionAccessTarget[], rows: PolicyRows) {
  return new Map(
    targets.flatMap((target) =>
      (target.kind === 'module'
        ? [
            target,
            ...(MODULE_SUBRESOURCES[target.key as keyof typeof MODULE_SUBRESOURCES] ?? []).map(
              (sub) => resolveSectionAccessTarget(sub.key, rows.nav)!,
            ),
          ]
        : [target]
      ).map((changed) => [changed.key, changed] as const),
    ),
  );
}
function auditRef(orgId: string, target: string): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([orgId, target]))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function persistPolicy(
  tx: CoreTx,
  actor: PolicyActor,
  target: SectionAccessTarget,
  old: RuleRow | null,
  next: RuleRow | null,
): Promise<void> {
  if (!next) {
    await tx.execute(
      sql`delete from permission_rules where org_id=${actor.orgId}::uuid and role_key=${old?.role_key ?? ''} and module=${target.key}`,
    );
  } else {
    await tx.execute(sql`insert into permission_rules
      (org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,updated_at)
      values (${actor.orgId}::uuid,${next.role_key},${target.key},${next.can_view},${next.can_create},${next.can_edit},${next.can_delete},${next.can_export},${next.can_manage},${next.if_owner ?? false},${next.field_level ?? 0},now())
      on conflict (org_id,role_key,module) do update set can_view=excluded.can_view,can_create=excluded.can_create,
      can_edit=excluded.can_edit,can_delete=excluded.can_delete,can_export=excluded.can_export,can_manage=excluded.can_manage,
      if_owner=excluded.if_owner,field_level=excluded.field_level,updated_at=now()`);
  }
  const simulation = currentEffectiveAuthority(actor.orgId, actor.profileId);
  const changes = [
    { field: target.key, label: target.label, old: canonicalRule(old), new: canonicalRule(next) },
  ];
  await tx.execute(sql`insert into doc_audit_log
    (org_id,ref_type,ref_id,actor_id,actor_name,op,changes,simulation_role_key,simulation_generation)
    values (${actor.orgId},'section_access',${auditRef(actor.orgId, target.key)}::uuid,${actor.profileId}::uuid,
      ${actor.name},'permission',${JSON.stringify(changes)}::jsonb,${simulation?.roleKey ?? null},${simulation?.generation ?? null}::uuid)`);
}

/** All revisions validate under the same lock BEFORE any parent or child write. */
export async function writeSectionAccess(
  locals: App.Locals,
  raw: unknown,
  resets: readonly PolicyReset[] = [],
): Promise<SectionAccessReceipt> {
  const parsed = sectionAccessWriteSchema.safeParse(raw);
  if (!parsed.success) throw error(400, 'Invalid access policy');
  const input = parsed.data;
  const actor = actorFor(locals);
  const committed = await getCoreDb().transaction(async (tx) => {
    await lockNavigationPolicy(tx, actor.orgId);
    let rows = await loadPolicyRows(tx, actor.orgId);
    const authority = await requireFreshPolicyActor(tx, actor, rows);
    const role = rows.roles.find((r) => r.key === input.roleKey);
    if (!role) throw error(400, 'Role no longer exists in this organization');
    if (role.key === 'owner') throw error(403, 'Owner access is protected');
    const target = resolveSectionAccessTarget(input.target, rows.nav);
    if (!target) throw error(404, 'Access target no longer exists');
    const targets = [{ target, revision: input.revision, mode: input.mode }];
    if (resets.length > 100 || new Set(resets.map((r) => r.target)).size !== resets.length)
      throw error(400, 'Invalid subresource reset batch');
    for (const reset of resets) {
      if (target.kind !== 'module' || !reset.target.startsWith(`${target.key}.`))
        throw error(400, 'Invalid child target');
      const sub = resolveSectionAccessTarget(reset.target, rows.nav);
      if (!sub || sub.kind !== 'subresource' || !/^[a-f0-9]{64}$/.test(reset.revision))
        throw error(400, 'Invalid child target');
      targets.push({ target: sub, revision: reset.revision, mode: 'inherit' });
    }
    for (const candidate of targets)
      if (sectionPolicyRevision(actor.orgId, candidate.target, role, rows) !== candidate.revision)
        throw error(409, 'Access changed. Reload and review your draft before applying.');
    const writes: { target: SectionAccessTarget; old: RuleRow | null; next: RuleRow | null }[] = [];
    for (const { target: candidate, mode } of targets) {
      const old = ruleFor(rows, role.key, candidate.key);
      const next = checkedMutation(
        candidate === target
          ? input
          : {
              ...input,
              target: candidate.key,
              mode,
              caps: undefined,
              ifOwner: undefined,
              fieldLevel: undefined,
            },
        candidate,
        old,
        buildCapabilities([role.key], rows.rules).fieldLevel(candidate.key),
      );
      rows = replaceRule(rows, candidate.key, role.key, next);
      writes.push({ target: candidate, old, next });
    }
    for (const target of affectedRegisteredTargets(
      writes.map((write) => write.target),
      rows,
    ).values())
      requireGrantCeiling(target, role, rows, authority);
    for (const write of writes) await persistPolicy(tx, actor, write.target, write.old, write.next);
    const revisions: Record<string, string> = {};
    const affected =
      target.kind === 'module'
        ? [
            target,
            ...(MODULE_SUBRESOURCES[target.key as keyof typeof MODULE_SUBRESOURCES] ?? []).map(
              (s) => resolveSectionAccessTarget(s.key, rows.nav)!,
            ),
          ]
        : [target];
    for (const changed of affected)
      revisions[changed.key] = sectionPolicyRevision(actor.orgId, changed, role, rows);
    return { ok: true as const, revision: revisions[target.key], revisions };
  });
  try {
    await invalidateRbac(actor.orgId);
  } catch {
    return { ...committed, refreshRequired: true };
  }
  return committed;
}

/** One Settings “Revert all” receipt; never retire authority midway through a role reset. */
export async function resetRegisteredRolePolicies(
  locals: App.Locals,
  roleKey: string,
  resets: readonly PolicyReset[],
): Promise<SectionAccessReceipt> {
  if (
    !roleKey ||
    roleKey.length > 256 ||
    resets.length < 1 ||
    resets.length > 256 ||
    new Set(resets.map((r) => r.target)).size !== resets.length ||
    resets.some((r) => typeof r.target !== 'string' || !/^[a-f0-9]{64}$/.test(r.revision))
  )
    throw error(400, 'Invalid registered policy reset batch');
  const actor = actorFor(locals);
  const committed = await getCoreDb().transaction(async (tx) => {
    await lockNavigationPolicy(tx, actor.orgId);
    let rows = await loadPolicyRows(tx, actor.orgId);
    const authority = await requireFreshPolicyActor(tx, actor, rows);
    const role = rows.roles.find((r) => r.key === roleKey);
    if (!role) throw error(400, 'Role no longer exists in this organization');
    if (role.key === 'owner') throw error(403, 'Owner access is protected');
    const targets = resets.map((reset) => {
      const target = resolveSectionAccessTarget(reset.target, rows.nav);
      if (!target || (target.kind !== 'module' && target.kind !== 'subresource'))
        throw error(400, 'Registered module or subresource required');
      if (sectionPolicyRevision(actor.orgId, target, role, rows) !== reset.revision)
        throw error(409, 'Access changed. Reload and review your draft before applying.');
      return target;
    });
    const writes = targets.map((target) => ({ target, old: ruleFor(rows, roleKey, target.key) }));
    // Compute the entire inherited result before evaluating grant ceilings or writing.
    for (const target of targets) rows = replaceRule(rows, target.key, roleKey, null);
    const affected = affectedRegisteredTargets(targets, rows);
    // A parent reset also changes inherited child access, even without a child row.
    for (const target of affected.values()) requireGrantCeiling(target, role, rows, authority);
    for (const write of writes) await persistPolicy(tx, actor, write.target, write.old, null);
    const revisions: Record<string, string> = {};
    for (const changed of affected.values())
      revisions[changed.key] = sectionPolicyRevision(actor.orgId, changed, role, rows);
    return { ok: true as const, revision: revisions[targets[0].key], revisions };
  });
  try {
    await invalidateRbac(actor.orgId);
  } catch {
    return { ...committed, refreshRequired: true };
  }
  return committed;
}

/** Canonical Settings matrix shares exactly the same revisions as the contextual editor. */
export async function listRoleAccessMatrix(orgId: string): Promise<RbacRoleView[]> {
  return getCoreDb().transaction(async (tx) => {
    const rows = await loadPolicyRows(tx, orgId);
    const members = await tx.execute<{ role_key: string; count: number } & Record<string, unknown>>(
      sql`select role_key,count(*)::integer as count from member_roles where org_id=${orgId}::uuid group by role_key`,
    );
    const counts = new Map(members.map((m) => [m.role_key, m.count]));
    return rows.roles.map((role) => {
      const caps = buildCapabilities([role.key], rows.rules);
      return {
        key: role.key,
        name: role.name,
        rank: role.rank,
        description: role.description,
        isSystem: role.is_system,
        memberCount: counts.get(role.key) ?? 0,
        modules: MODULES.map((module) => {
          const target = resolveSectionAccessTarget(module, rows.nav)!;
          return {
            module,
            label: target.label,
            caps: actionSet(caps, module),
            overridden: ruleFor(rows, role.key, module) !== null,
            revision: sectionPolicyRevision(orgId, target, role, rows),
            ifOwner: caps.ownerScoped(module),
            ownerScopable: target.ownerScopable,
            fieldLevel: caps.fieldLevel(module),
            fieldScopable: target.fieldScopable,
            subResources: (MODULE_SUBRESOURCES[module] ?? []).map((sub) => ({
              key: sub.key,
              label: sub.label,
              caps: actionSet(caps, sub.key),
              overridden: ruleFor(rows, role.key, sub.key) !== null,
              revision: sectionPolicyRevision(
                orgId,
                resolveSectionAccessTarget(sub.key, rows.nav)!,
                role,
                rows,
              ),
            })),
          };
        }),
      };
    });
  });
}

/** Called only by the locked whole-nav transaction, so no removed target can be recreated concurrently. */
export async function pruneRemovedNavigationPolicies(
  tx: CoreTx,
  scope: { tenantId: string; profileId?: string },
  keep: readonly string[],
): Promise<void> {
  const rows = await tx.execute<RuleRow>(sql`
    select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level
    from permission_rules where org_id=${scope.tenantId}::uuid and module ~ '^(page:[a-z0-9]{6}|section:[a-z0-9]{6})$'
  `);
  const live = new Set(keep);
  for (const row of rows) {
    if (live.has(row.module)) continue;
    await tx.execute(
      sql`delete from permission_rules where org_id=${scope.tenantId}::uuid and role_key=${row.role_key} and module=${row.module}`,
    );
    const simulation = scope.profileId
      ? currentEffectiveAuthority(scope.tenantId, scope.profileId)
      : undefined;
    await tx.execute(sql`insert into doc_audit_log
      (org_id,ref_type,ref_id,actor_id,op,changes,simulation_role_key,simulation_generation)
      values (${scope.tenantId},'section_access',${auditRef(scope.tenantId, row.module)}::uuid,
        ${scope.profileId ?? null}::uuid,'target_removed',
        ${JSON.stringify([{ field: row.module, roleKey: row.role_key, old: canonicalRule(row), new: null }])}::jsonb,
        ${simulation?.roleKey ?? null},${simulation?.generation ?? null}::uuid)`);
  }
}

/** Catalog removal is a policy writer: serialize it with both policy editors and nav cleanup. */
export async function deleteRoleAccessCatalog(locals: App.Locals, key: string): Promise<void> {
  const actor = actorFor(locals);
  await getCoreDb().transaction(async (tx) => {
    await lockNavigationPolicy(tx, actor.orgId);
    const rows = await loadPolicyRows(tx, actor.orgId);
    const authority = await requireFreshPolicyActor(tx, actor, rows);
    const role = rows.roles.find((row) => row.key === key && !row.is_system);
    if (!role) throw error(404, 'Custom role not found');
    if (role.rank > authority.rank) throw error(403, 'Cannot remove a role above your authority');
    const assigned = await tx.execute<{ profile_id: string } & Record<string, unknown>>(
      sql`select profile_id from member_roles where org_id=${actor.orgId}::uuid and role_key=${key} for share`,
    );
    if (assigned.length) throw error(409, 'This role is still assigned to a member');
    await tx.execute(
      sql`delete from permission_rules where org_id=${actor.orgId}::uuid and role_key=${key}`,
    );
    await tx.execute(sql`delete from org_roles where org_id=${actor.orgId}::uuid and key=${key}`);
    const simulation = currentEffectiveAuthority(actor.orgId, actor.profileId);
    const removed = {
      key: role.key,
      name: role.name,
      rank: role.rank,
      policies: rows.rules
        .filter((row) => row.role_key === key)
        .map((row) => [row.module, canonicalRule(row)]),
    };
    await tx.execute(sql`insert into doc_audit_log
      (org_id,ref_type,ref_id,actor_id,actor_name,op,changes,simulation_role_key,simulation_generation)
      values (${actor.orgId},'section_access',${auditRef(actor.orgId, `role:${key}`)}::uuid,${actor.profileId}::uuid,
        ${actor.name},'role_delete',${JSON.stringify([{ field: 'role', old: removed, new: null }])}::jsonb,
        ${simulation?.roleKey ?? null},${simulation?.generation ?? null}::uuid)`);
  });
  try {
    await invalidateRbac(actor.orgId);
  } catch {
    console.warn('[roles] committed removal; permission refresh required');
  }
}
