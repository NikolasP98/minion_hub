import { createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { CoreTx } from '$server/db/with-org-core';
import type { Capabilities } from './rbac.service';
import type { OrganizationRoleModel } from './organization-role-policy';

export interface RoleBrainAsset {
  id: string;
  created_by: string | null;
  visibility: string;
}
export interface RoleBrainAccess {
  brain_id: string;
  principal_type: string;
  principal_id: string;
  level: string;
}
export interface RolePersonalAgent {
  profile_id: string;
  agent_id: string;
}
export interface BrainRoleGrantSnapshot {
  brains: RoleBrainAsset[];
  access: RoleBrainAccess[];
  personalAgents?: RolePersonalAgent[];
}
export interface BrainRoleSelection {
  roles: readonly string[];
  caps: Capabilities;
}
export interface BrainRoleActor extends BrainRoleSelection {
  profileId: string;
}
export interface BrainRoleRecipient extends BrainRoleActor {
  active: boolean;
}
export const ROLE_BRAIN_LIMITS = {
  brains: 4096,
  access: 65536,
  personalAgents: 65536,
  policyRecipients: 4096,
  policyEvaluatedCells: 1_000_000,
} as const;
export interface RoleBrainTables {
  brains: string;
  access: string;
  personalAgents?: string;
}
const DEFAULT_TABLES: RoleBrainTables = {
  brains: 'public.brains',
  access: 'public.brain_access',
  personalAgents: 'public.personal_agents',
};
const qualified = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/.test(name))
    throw Error('Invalid Brain authority table');
  return sql.join(
    name.split('.').map((part) => sql.identifier(part)),
    sql.raw('.'),
  );
};
/** Caller holds organization policy lock 112. Share locks retain the exact source rows until commit. */
export async function readRoleBrainGrants(
  tx: CoreTx | postgres.TransactionSql,
  orgId: string,
  tables: RoleBrainTables = DEFAULT_TABLES,
): Promise<BrainRoleGrantSnapshot> {
  let brains: RoleBrainAsset[], access: RoleBrainAccess[], personalAgents: RolePersonalAgent[];
  if (typeof tx === 'function') {
    qualified(tables.brains);
    qualified(tables.access);
    qualified(tables.personalAgents ?? DEFAULT_TABLES.personalAgents!);
    brains = [
      ...(await tx<
        RoleBrainAsset[]
      >`select id::text,created_by,visibility from ${tx(tables.brains)} where org_id=${orgId} order by id limit ${ROLE_BRAIN_LIMITS.brains + 1} for share`),
    ];
    access = [
      ...(await tx<
        RoleBrainAccess[]
      >`select brain_id::text,principal_type,principal_id,level from ${tx(tables.access)} where org_id=${orgId} and principal_type in ('role','user','agent') order by brain_id,principal_type,principal_id limit ${ROLE_BRAIN_LIMITS.access + 1} for share`),
    ];
  } else {
    brains = [
      ...(await tx.execute<RoleBrainAsset & Record<string, unknown>>(
        sql`select id::text,created_by,visibility from ${qualified(tables.brains)} where org_id=${orgId} order by id limit ${ROLE_BRAIN_LIMITS.brains + 1} for share`,
      )),
    ];
    access = [
      ...(await tx.execute<RoleBrainAccess & Record<string, unknown>>(
        sql`select brain_id::text,principal_type,principal_id,level from ${qualified(tables.access)} where org_id=${orgId} and principal_type in ('role','user','agent') order by brain_id,principal_type,principal_id limit ${ROLE_BRAIN_LIMITS.access + 1} for share`,
      )),
    ];
  }
  const personalTable = tables.personalAgents ?? DEFAULT_TABLES.personalAgents!;
  if (typeof tx === 'function')
    personalAgents = [
      ...(await tx<
        RolePersonalAgent[]
      >`select p.profile_id::text,p.agent_id from ${tx(personalTable)} p where exists(select 1 from ${tx(tables.access)} a where a.org_id=${orgId} and a.principal_type='agent' and lower(a.principal_id)=lower(p.agent_id)) order by p.agent_id,p.profile_id limit ${ROLE_BRAIN_LIMITS.personalAgents + 1} for share of p`),
    ];
  else
    personalAgents = [
      ...(await tx.execute<RolePersonalAgent & Record<string, unknown>>(
        sql`select p.profile_id::text,p.agent_id from ${qualified(personalTable)} p where exists(select 1 from ${qualified(tables.access)} a where a.org_id=${orgId} and a.principal_type='agent' and lower(a.principal_id)=lower(p.agent_id)) order by p.agent_id,p.profile_id limit ${ROLE_BRAIN_LIMITS.personalAgents + 1} for share of p`,
      )),
    ];
  if (
    brains.length > ROLE_BRAIN_LIMITS.brains ||
    access.length > ROLE_BRAIN_LIMITS.access ||
    personalAgents.length > ROLE_BRAIN_LIMITS.personalAgents
  )
    throw error(503, 'Role Brain authority exceeds the supported limit');
  if (
    brains.some((brain) => !brain.id || !['org', 'private'].includes(brain.visibility)) ||
    access.some((row) => !['read', 'write'].includes(row.level))
  )
    throw error(503, 'Role Brain authority unavailable');
  const snapshot = { brains, access, personalAgents };
  brainIndex(snapshot);
  return snapshot;
}
function fullScope(model: OrganizationRoleModel, selection: BrainRoleSelection): boolean {
  return model === 'legacy'
    ? selection.roles.some((role) => role === 'owner' || role === 'admin')
    : selection.caps.can('brains', 'view') && selection.caps.can('brains', 'manage');
}
interface BrainIndex {
  brains: Map<string, RoleBrainAsset>;
  roles: Map<string, Map<string, number>>;
  users: Map<string, Map<string, number>>;
  personal: Map<string, Map<string, number>>;
  actorLevels: Record<
    OrganizationRoleModel,
    {
      browser: WeakMap<BrainRoleActor, Map<string, number>>;
      recipient: WeakMap<BrainRoleActor, Map<string, number>>;
    }
  >;
  recipients: number;
  cells: number;
}
const indices = new WeakMap<BrainRoleGrantSnapshot, BrainIndex>();
function brainIndex(snapshot: BrainRoleGrantSnapshot): BrainIndex {
  const cached = indices.get(snapshot);
  if (cached) return cached;
  const index: BrainIndex = {
    brains: new Map(snapshot.brains.map((brain) => [brain.id, brain])),
    roles: new Map(),
    users: new Map(),
    personal: new Map(),
    actorLevels: {
      legacy: { browser: new WeakMap(), recipient: new WeakMap() },
      organization: { browser: new WeakMap(), recipient: new WeakMap() },
    },
    recipients: 0,
    cells: 0,
  };
  for (const row of snapshot.access) {
    const target =
      row.principal_type === 'role'
        ? index.roles
        : row.principal_type === 'user'
          ? index.users
          : null;
    if (!target) continue;
    let map = target.get(row.principal_id);
    if (!map) {
      map = new Map();
      target.set(row.principal_id, map);
    }
    map.set(row.brain_id, (map.get(row.brain_id) ?? 0) | (row.level === 'write' ? 3 : 1));
  }
  const owners = new Map<string, string>();
  for (const binding of snapshot.personalAgents ?? []) {
    if (
      /^brain-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
        binding.agent_id,
      )
    )
      continue;
    const key = binding.agent_id.toLowerCase();
    if (owners.has(key)) throw error(503, 'Ambiguous personal agent authority');
    owners.set(key, binding.profile_id);
  }
  for (const row of snapshot.access)
    if (row.principal_type === 'agent') {
      const owner = owners.get(row.principal_id.toLowerCase());
      if (!owner) continue;
      let levels = index.personal.get(owner);
      if (!levels) {
        levels = new Map();
        index.personal.set(owner, levels);
      }
      levels.set(row.brain_id, (levels.get(row.brain_id) ?? 0) | (row.level === 'write' ? 3 : 1));
    }
  indices.set(snapshot, index);
  return index;
}
function rawRoleLevels(
  model: OrganizationRoleModel,
  snapshot: BrainRoleGrantSnapshot,
  selection: BrainRoleSelection,
): Map<string, number> {
  const index = brainIndex(snapshot),
    levels = new Map<string, number>();
  if (fullScope(model, selection)) for (const id of index.brains.keys()) levels.set(id, 3);
  for (const role of new Set(selection.roles))
    for (const [id, level] of index.roles.get(role) ?? [])
      levels.set(id, (levels.get(id) ?? 0) | level);
  return levels;
}
function actorLevels(
  model: OrganizationRoleModel,
  snapshot: BrainRoleGrantSnapshot,
  actor: BrainRoleActor,
  includePersonalAgents = false,
): Map<string, number> {
  const index = brainIndex(snapshot),
    cached = index.actorLevels[model][includePersonalAgents ? 'recipient' : 'browser'].get(actor);
  if (cached) return cached;
  const levels = new Map<string, number>();
  index.actorLevels[model][includePersonalAgents ? 'recipient' : 'browser'].set(actor, levels);
  if (!actor.caps.can('brains', 'view')) return levels;
  for (const role of new Set(actor.roles))
    for (const [id, level] of index.roles.get(role) ?? [])
      levels.set(id, (levels.get(id) ?? 0) | level);
  for (const [id, level] of index.users.get(actor.profileId) ?? [])
    levels.set(id, (levels.get(id) ?? 0) | level);
  if (includePersonalAgents)
    for (const [id, level] of index.personal.get(actor.profileId) ?? [])
      levels.set(id, (levels.get(id) ?? 0) | level);
  const all = fullScope(model, actor),
    ownerScoped = actor.caps.ownerScoped('brains');
  for (const brain of snapshot.brains) {
    if (ownerScoped && brain.created_by !== actor.profileId) levels.set(brain.id, 0);
    else if (brain.created_by === actor.profileId || all) levels.set(brain.id, 3);
    else if (brain.visibility === 'org') levels.set(brain.id, (levels.get(brain.id) ?? 0) | 1);
  }
  return levels;
}
const ACTION_LEVEL = { view: 1, export: 1, edit: 3, delete: 3, manage: 3 } as const;
export function roleBrainGrantRevision(input: {
  roleModel: OrganizationRoleModel;
  snapshot: BrainRoleGrantSnapshot;
  selected: BrainRoleSelection;
}): string {
  const selectedRoles = new Set(input.selected.roles);
  const roleRows = input.snapshot.access
    .filter((row) => row.principal_type === 'role' && selectedRoles.has(row.principal_id))
    .map((row) => [row.brain_id, row.principal_id, row.level])
    .sort((a, b) => {
      const left = JSON.stringify(a),
        right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return createHash('sha256')
    .update(JSON.stringify({ fullScope: fullScope(input.roleModel, input.selected), roleRows }))
    .digest('hex');
}
/** Compare newly exposed object rights, retaining conservative latent role-ACL checks on new role grants. */
export function assertRoleBrainGrantCeiling(input: {
  roleModel: OrganizationRoleModel;
  snapshot: BrainRoleGrantSnapshot;
  actual: BrainRoleActor;
  effective?: BrainRoleActor;
  selected: BrainRoleSelection;
  previous?: BrainRoleSelection;
}): { revision: string } {
  const { roleModel, snapshot, selected, previous } = input;
  const selectedFull = fullScope(roleModel, selected),
    previousFull = !!previous && fullScope(roleModel, previous);
  const widenedActions = (Object.keys(ACTION_LEVEL) as (keyof typeof ACTION_LEVEL)[]).filter(
    (action) =>
      selected.caps.can('brains', action) && (!previous || !previous.caps.can('brains', action)),
  );
  const scopeWidened =
    !!previous &&
    previous.caps.ownerScoped('brains') &&
    !selected.caps.ownerScoped('brains') &&
    selected.caps.can('brains', 'view');
  const after = rawRoleLevels(roleModel, snapshot, selected),
    before = previous ? rawRoleLevels(roleModel, snapshot, previous) : new Map<string, number>();
  const authorities = [input.actual, ...(input.effective ? [input.effective] : [])].map(
    (actor) => ({ actor, levels: actorLevels(roleModel, snapshot, actor) }),
  );
  const brainsById = brainIndex(snapshot).brains;
  // This categorical scope also covers future private Brains. Owning every current Brain is insufficient.
  if (selectedFull && (!previousFull || widenedActions.length > 0 || scopeWidened))
    for (const { actor } of authorities) {
      if (
        !fullScope(roleModel, actor) ||
        actor.caps.ownerScoped('brains') ||
        !actor.caps.can('brains', 'view') ||
        (!previousFull && !actor.caps.can('brains', 'edit')) ||
        widenedActions.some((action) => !actor.caps.can('brains', action))
      )
        throw error(
          403,
          'Cannot grant unrestricted private Brain access beyond your own authority',
        );
    }
  for (const [id, level] of after) {
    const added = level & ~(before.get(id) ?? 0);
    if (!added && !widenedActions.length && !scopeWidened) continue;
    const brain = brainsById.get(id);
    if (!brain) throw error(503, 'Role Brain asset unavailable');
    for (const { actor, levels } of authorities) {
      const held = levels.get(id) ?? 0;
      // A new role ACL can combine with a recipient's other roles, even if this role currently hides Brains.
      if (
        added &&
        ((held & level) !== level ||
          !actor.caps.can('brains', 'view') ||
          ((level & 2) !== 0 && !actor.caps.can('brains', 'edit')))
      )
        throw error(403, 'Cannot grant role-linked Brain access beyond your own authority');
      if (
        widenedActions.some(
          (action) =>
            (level & ACTION_LEVEL[action]) === ACTION_LEVEL[action] &&
            (!actor.caps.can('brains', action) ||
              (held & ACTION_LEVEL[action]) !== ACTION_LEVEL[action]),
        ) ||
        (scopeWidened && (held & level) !== level)
      )
        throw error(403, 'Cannot widen role-linked Brain actions beyond your own authority');
    }
  }
  return { revision: roleBrainGrantRevision(input) };
}

/** Recipient identity can reactivate retained user ACLs or creator access when module permissions or membership change. */
export function assertRecipientBrainGrantCeiling(input: {
  roleModel: OrganizationRoleModel;
  snapshot: BrainRoleGrantSnapshot;
  actual: BrainRoleActor;
  effective?: BrainRoleActor;
  before: BrainRoleRecipient;
  after: BrainRoleRecipient;
}): void {
  const { roleModel, snapshot, before, after } = input;
  if (before.profileId !== after.profileId)
    throw error(503, 'Recipient authority identity changed');
  const index = brainIndex(snapshot);
  index.recipients++;
  const roles = new Set([...before.roles, ...after.roles]);
  index.cells +=
    snapshot.brains.length +
    (index.users.get(after.profileId)?.size ?? 0) +
    (index.personal.get(after.profileId)?.size ?? 0) +
    [...roles].reduce((sum, role) => sum + (index.roles.get(role)?.size ?? 0), 0);
  if (
    index.recipients > ROLE_BRAIN_LIMITS.policyRecipients ||
    index.cells > ROLE_BRAIN_LIMITS.policyEvaluatedCells
  )
    throw error(503, 'Recipient Brain authority exceeds the supported limit');
  const beforeLevels = before.active
    ? actorLevels(roleModel, snapshot, before, true)
    : new Map<string, number>();
  const afterLevels = after.active
    ? actorLevels(roleModel, snapshot, after, true)
    : new Map<string, number>();
  const beforeBrowserLevels = before.active
    ? actorLevels(roleModel, snapshot, before)
    : new Map<string, number>();
  const afterBrowserLevels = after.active
    ? actorLevels(roleModel, snapshot, after)
    : new Map<string, number>();
  const authorities = [input.actual, ...(input.effective ? [input.effective] : [])].map(
    (actor) => ({ actor, levels: actorLevels(roleModel, snapshot, actor) }),
  );
  const beforeFull = before.active && fullScope(roleModel, before),
    afterFull = after.active && fullScope(roleModel, after);
  const widenedActions = (Object.keys(ACTION_LEVEL) as (keyof typeof ACTION_LEVEL)[]).filter(
    (action) =>
      after.active &&
      after.caps.can('brains', action) &&
      (!before.active || !before.caps.can('brains', action)),
  );
  const scopeWidened =
    before.active &&
    before.caps.ownerScoped('brains') &&
    !after.caps.ownerScoped('brains') &&
    after.caps.can('brains', 'view');
  if (afterFull && (!beforeFull || widenedActions.length || scopeWidened))
    for (const { actor } of authorities) {
      if (
        !fullScope(roleModel, actor) ||
        actor.caps.ownerScoped('brains') ||
        !actor.caps.can('brains', 'view') ||
        (!beforeFull && !actor.caps.can('brains', 'edit')) ||
        widenedActions.some((action) => !actor.caps.can('brains', action))
      )
        throw error(
          403,
          'Cannot restore unrestricted private Brain access beyond your own authority',
        );
    }
  for (const brain of snapshot.brains)
    for (const action of Object.keys(ACTION_LEVEL) as (keyof typeof ACTION_LEVEL)[]) {
      const needed = ACTION_LEVEL[action];
      const hasAfter =
        after.active &&
        after.caps.can('brains', action) &&
        (((action === 'view' || action === 'edit' ? afterLevels : afterBrowserLevels).get(
          brain.id,
        ) ?? 0) &
          needed) ===
          needed;
      const hadBefore =
        before.active &&
        before.caps.can('brains', action) &&
        (((action === 'view' || action === 'edit' ? beforeLevels : beforeBrowserLevels).get(
          brain.id,
        ) ?? 0) &
          needed) ===
          needed;
      if (!hasAfter || hadBefore) continue;
      for (const { actor, levels } of authorities)
        if (!actor.caps.can('brains', action) || ((levels.get(brain.id) ?? 0) & needed) !== needed)
          throw error(403, 'Cannot restore recipient Brain access beyond your own authority');
    }
}
