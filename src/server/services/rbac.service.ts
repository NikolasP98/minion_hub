import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import {
  MODULE_SUBRESOURCES,
  ALL_SUBRESOURCES,
  FIELD_LEVEL_MODULES,
  SENSITIVE_FIELD_LEVEL,
  type SubResource,
} from '$lib/permissions';

/**
 * RBAC capability engine (ERPNext-inspired) — the single source of truth for
 * "which org role can do what to which module", consulted by the API endpoints
 * and the agent's data tools so authorization lives in ONE place.
 *
 * Model:
 *  - permission_roles  — global role catalog (owner > admin > manager > staff > viewer).
 *  - member_roles      — per-org, per-profile assignments (multi-role).
 *  - permission_rules  — per-ORG capability OVERRIDES (role×module×action).
 *  - DEFAULT_MATRIX    — global defaults (here, in code). Effective cap for a
 *    (role, module, action) = the org override row if present, else this default.
 *
 * A member's effective capability = OR across all their assigned roles. The agent
 * inherits the signed-in user's capabilities — it can never do more than the user.
 *
 * Relationship to the legacy `permissions.service.ts` / `$lib/permissions`: that
 * system gates PLATFORM nav (agents/sessions/channels/settings/users…) off
 * profiles.role and is unchanged for now. THIS engine adds BUSINESS-DATA gating
 * (crm/finance/sales/scheduling/support/projects/memberships/comms), which was
 * previously ungated. Phase 2 unifies the two behind this engine.
 *
 * Later phases refine, not replace, this interface: record-level scoping (ERPNext
 * "User Permissions" / if-owner) via per-user RLS predicates, and field-level
 * gating (permission levels) via tiered DB roles — a granted capability stays the
 * same boolean; those layers narrow which rows/columns it reaches.
 */

export const MODULES = [
  'overview',
  // business data
  'crm',
  'finance',
  'sales',
  'scheduling',
  'support',
  'projects',
  'memberships',
  'comms',
  'brains',
  'stock',
  'ads',
  'pos',
  // platform / admin
  'agents',
  'channels',
  'flows',
  'marketplace',
  'reliability',
  'workspace',
  'settings',
  'users',
  'tools',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'manage'] as const;
export type PermAction = (typeof ACTIONS)[number];
export type ActionSet = Record<PermAction, boolean>;

/** Human labels + grouping for the Role Permission Manager UI. */
export const MODULE_LABELS: Record<Module, string> = {
  overview: 'Overview',
  crm: 'CRM',
  finance: 'Finances',
  sales: 'Sales',
  scheduling: 'Scheduling',
  support: 'Support',
  projects: 'Projects',
  memberships: 'Memberships',
  comms: 'Comms',
  brains: 'AI Brains',
  stock: 'Stock',
  ads: 'Ads',
  pos: 'Point of Sale',
  agents: 'Agents',
  channels: 'Channels',
  flows: 'Agent Builder',
  marketplace: 'Marketplace',
  reliability: 'Reliability',
  workspace: 'Cloud Workspaces',
  settings: 'Settings',
  users: 'Users & Team',
  tools: 'Tool Studio',
};

/** Modules that hold business data (vs platform/admin config). */
export const BUSINESS_MODULES: readonly Module[] = [
  'crm',
  'finance',
  'sales',
  'scheduling',
  'support',
  'projects',
  'memberships',
  'comms',
  'brains',
  'stock',
  'ads',
  'pos',
];
const ADMIN_MODULES: readonly Module[] = [
  'agents',
  'channels',
  'flows',
  'marketplace',
  'reliability',
  'workspace',
  'settings',
  'users',
  'tools',
];

const NONE: ActionSet = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
  manage: false,
};
const set = (a: Partial<ActionSet>): ActionSet => ({ ...NONE, ...a });
const ALL: ActionSet = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
  manage: true,
};
const RWXE = set({ view: true, create: true, edit: true, export: true });
// pos: manager gets `manage` too (register/session close), unlike other business modules.
const RWXEM = set({ view: true, create: true, edit: true, export: true, manage: true });
const RWX = set({ view: true, create: true, edit: true });
const VIEW = set({ view: true });

/**
 * Enforce the action-dependency invariant: every action (create/edit/delete/
 * export/manage) requires `view`. So if `view` is off, nothing else can be on.
 * Applied server-side on every override write so a hand-crafted POST can't store
 * an impossible cell (create without view); the UI mirrors it for the cascade.
 */
export function normalizeViewDependency(caps: ActionSet): ActionSet {
  return caps.view ? caps : { ...NONE };
}

/**
 * Global default capabilities per role per module. Org overrides take precedence
 * per (role, module). Unknown roles/modules default to NONE (fail-closed).
 */
export function defaultCaps(roleKey: string, module: Module): ActionSet {
  if (module === 'overview') return VIEW; // everyone sees the dashboard
  switch (roleKey) {
    case 'owner':
    case 'admin':
      return ALL;
    case 'manager':
      if (module === 'pos') return RWXEM; // full business data + manage (register/session close)
      if (BUSINESS_MODULES.includes(module)) return RWXE; // full business data, no delete/manage
      if (ADMIN_MODULES.includes(module)) return VIEW;
      return NONE;
    case 'staff':
      if (['crm', 'scheduling', 'support', 'comms', 'pos'].includes(module)) return RWX;
      if (['finance', 'sales', 'projects', 'memberships'].includes(module)) return VIEW;
      return NONE;
    case 'viewer':
      if (BUSINESS_MODULES.includes(module)) return VIEW;
      return NONE;
    default:
      return NONE;
  }
}

/** Map a legacy organization_members.role to a role key (back-compat fallback). */
export function legacyRoleKey(role: string | null | undefined): string {
  if (role === 'owner') return 'owner';
  if (role === 'admin') return 'admin';
  if (role === 'member') return 'manager'; // matches the migration backfill
  return 'viewer';
}

export interface Capabilities {
  roles: string[];
  /**
   * Effective permission for a module+action across all of the member's roles.
   * Accepts a dotted sub-resource key (e.g. `crm.insights`) which inherits its
   * parent module's caps unless an explicit override exists.
   */
  can(module: Module | string, action: PermAction): boolean;
  /** True if the member can read ANY business module — the bar for analytics SQL. */
  canRunAnalytics(): boolean;
  /** Modules the member can at least view. */
  visibleModules(): Module[];
  /**
   * Record-level (if-owner) scope for a module: true when the member can view it
   * but EVERY role granting that view restricts to owned records — so reads must
   * be filtered to `owner_id = current profile`. False when any role grants
   * un-restricted view (least-restrictive wins) or when they can't view at all.
   */
  ownerScoped(module: Module | string): boolean;
  /**
   * Field-level (ERPNext permission level): the max sensitivity tier the member
   * may read on a module = MAX across their roles (least-restrictive). Compare
   * with SENSITIVE_FIELD_LEVEL to decide whether to mask PII / cost / margin.
   */
  fieldLevel(module: Module | string): number;
}

interface OverrideRow {
  role_key: string;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  can_manage: boolean;
  if_owner?: boolean;
  field_level?: number;
}

/**
 * Default field-level for a role on a module: 1 (full visibility) for every role
 * on modules that HAVE a sensitive tier, else 0. So masking is opt-in — an org
 * lowers a role to 0 to hide PII / cost / margin; nobody loses access by default.
 */
export function defaultFieldLevel(module: string): number {
  return module in FIELD_LEVEL_MODULES ? SENSITIVE_FIELD_LEVEL : 0;
}

export function buildCapabilities(roles: string[], overrides: OverrideRow[]): Capabilities {
  const ovr = new Map<string, ActionSet>();
  const ifOwner = new Map<string, boolean>();
  const fieldLvl = new Map<string, number>();
  for (const r of overrides) {
    ovr.set(`${r.role_key}:${r.module}`, {
      view: r.can_view,
      create: r.can_create,
      edit: r.can_edit,
      delete: r.can_delete,
      export: r.can_export,
      manage: r.can_manage,
    });
    if (r.if_owner) ifOwner.set(`${r.role_key}:${r.module}`, true);
    if (typeof r.field_level === 'number') fieldLvl.set(`${r.role_key}:${r.module}`, r.field_level);
  }
  // A dotted sub-resource key (`crm.insights`) with no explicit override inherits
  // its parent module's effective caps (override-or-default), recursively.
  const effective = (roleKey: string, mod: string): ActionSet => {
    const o = ovr.get(`${roleKey}:${mod}`);
    if (o) return o;
    const dot = mod.indexOf('.');
    if (dot > 0) return effective(roleKey, mod.slice(0, dot));
    return defaultCaps(roleKey, mod as Module);
  };
  // Owner-scope inherits parent module for sub-keys (same as caps).
  const roleIfOwner = (roleKey: string, mod: string): boolean => {
    if (ifOwner.has(`${roleKey}:${mod}`)) return true;
    const dot = mod.indexOf('.');
    return dot > 0 ? roleIfOwner(roleKey, mod.slice(0, dot)) : false;
  };

  const can = (module: string, action: PermAction): boolean =>
    roles.some((rk) => effective(rk, module)[action]);

  // Scoped when viewable AND no role grants un-restricted view (least-restrictive
  // wins: a single full-access role lifts the restriction).
  const ownerScoped = (module: string): boolean =>
    can(module, 'view') &&
    !roles.some((rk) => effective(rk, module).view && !roleIfOwner(rk, module));

  // Field level inherits parent for sub-keys; MAX across roles (least-restrictive).
  const roleFieldLevel = (roleKey: string, mod: string): number => {
    const o = fieldLvl.get(`${roleKey}:${mod}`);
    if (o !== undefined) return o;
    const dot = mod.indexOf('.');
    return dot > 0 ? roleFieldLevel(roleKey, mod.slice(0, dot)) : defaultFieldLevel(mod);
  };
  const fieldLevel = (module: string): number =>
    roles.reduce((max, rk) => Math.max(max, roleFieldLevel(rk, module)), 0);

  return {
    roles,
    can,
    canRunAnalytics: () => BUSINESS_MODULES.some((m) => can(m, 'view')),
    visibleModules: () => MODULES.filter((m) => can(m, 'view')),
    ownerScoped,
    fieldLevel,
  };
}

/**
 * Resolve a member's effective capabilities in an org. Reads role assignments
 * (member_roles, falling back to organization_members for un-backfilled rows) and
 * any per-org overrides via the service-role client. The caller must already be
 * authorized + org-scoped upstream (resolveAssistantPrincipal does this).
 */
export async function resolveCapabilities(orgId: string, profileId: string): Promise<Capabilities> {
  const admin = supabaseAdmin();

  const memberRolesResult = await admin
    .from('member_roles')
    .select('role_key')
    .eq('org_id', orgId)
    .eq('profile_id', profileId);
  if (memberRolesResult.error) {
    throw new Error('Failed to resolve member role assignments', {
      cause: memberRolesResult.error,
    });
  }
  let roles = ((memberRolesResult.data ?? []) as Array<{ role_key: string }>).map(
    (r) => r.role_key,
  );

  if (roles.length === 0) {
    const legacyMembershipResult = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('profile_id', profileId)
      .maybeSingle();
    if (legacyMembershipResult.error) {
      throw new Error('Failed to resolve legacy organization membership', {
        cause: legacyMembershipResult.error,
      });
    }
    const legacyMembership = legacyMembershipResult.data as { role: string | null } | null;
    // A present legacy row with a null/unknown role intentionally keeps the
    // historical least-privilege viewer fallback. No membership row is not a
    // role assignment and must remain an empty authority set.
    roles = legacyMembership ? [legacyRoleKey(legacyMembership.role)] : [];
  }

  if (roles.length === 0) return buildCapabilities([], []);

  const permissionRulesResult = await admin
    .from('permission_rules')
    .select(
      'role_key, module, can_view, can_create, can_edit, can_delete, can_export, can_manage, if_owner, field_level',
    )
    .eq('org_id', orgId)
    .in('role_key', roles);
  if (permissionRulesResult.error) {
    throw new Error('Failed to resolve role permission rules', {
      cause: permissionRulesResult.error,
    });
  }

  return buildCapabilities(roles, (permissionRulesResult.data ?? []) as OverrideRow[]);
}

/**
 * The acting user's effective field level on a module (PII / cost / margin
 * gating). Platform admins always see everything. Pair with SENSITIVE_FIELD_LEVEL
 * in the owning service: `level < SENSITIVE_FIELD_LEVEL` → mask the sensitive
 * fields.
 */
export async function resolveFieldLevel(locals: App.Locals, module: Module): Promise<number> {
  const user = locals.user;
  if (!user) return 0;
  if (user.role === 'admin') return Number.MAX_SAFE_INTEGER;
  if (!locals.tenantCtx || !user.supabaseId) return defaultFieldLevel(module);
  const caps = await resolveCapabilities(locals.tenantCtx.tenantId, user.supabaseId);
  return caps.fieldLevel(module);
}

/** True when the acting user may NOT read the module's sensitive fields. */
export async function shouldMaskSensitive(locals: App.Locals, module: Module): Promise<boolean> {
  return (await resolveFieldLevel(locals, module)) < SENSITIVE_FIELD_LEVEL;
}

/**
 * Modules that support record-level (if-owner) scoping, mapped to the owner
 * column on their primary table. Only these can be owner-restricted (the matrix
 * toggle is hidden for the rest); enforcement happens in the owning service.
 */
export const OWNER_SCOPABLE_MODULES: Partial<Record<Module, string>> = {
  crm: 'owner_id',
  sales: 'owner_id',
  support: 'owner_id',
};

/**
 * Resolve whether the acting user is owner-scoped on a module (and on what
 * column). Returns `{ scoped, column, profileId }` — `scoped:false` means full
 * org visibility. Platform admins are never owner-scoped.
 */
export async function resolveOwnerScope(
  locals: App.Locals,
  module: Module,
): Promise<{ scoped: boolean; column: string | null; profileId: string | null }> {
  const column = OWNER_SCOPABLE_MODULES[module] ?? null;
  const user = locals.user;
  if (!column || !user || user.role === 'admin' || !user.supabaseId || !locals.tenantCtx) {
    return { scoped: false, column, profileId: user?.supabaseId ?? null };
  }
  const caps = await resolveCapabilities(locals.tenantCtx.tenantId, user.supabaseId);
  return { scoped: caps.ownerScoped(module), column, profileId: user.supabaseId };
}

/**
 * Convenience for service callers: the profile id to filter records by for
 * record-level scoping, or `undefined` for full org visibility. Pass straight
 * into a service's `ownerId` param.
 */
export async function ownerFilter(locals: App.Locals, module: Module): Promise<string | undefined> {
  const { scoped, profileId } = await resolveOwnerScope(locals, module);
  return scoped && profileId ? profileId : undefined;
}

// ── Role Permission Manager (settings/roles) ────────────────────────────────

function rowToActionSet(r: OverrideRow): ActionSet {
  return {
    view: r.can_view,
    create: r.can_create,
    edit: r.can_edit,
    delete: r.can_delete,
    export: r.can_export,
    manage: r.can_manage,
  };
}

export interface SubResourceCaps {
  key: string;
  label: string;
  caps: ActionSet;
  /** True when this org stored an override for (role, sub-resource); else inherited from parent. */
  overridden: boolean;
}
export interface RoleModuleCaps {
  module: Module;
  label: string;
  caps: ActionSet;
  /** True when this org has a stored override for (role, module) — else it's the code default. */
  overridden: boolean;
  /** Gateable subpages nested under this module (expandable rows in the UI). */
  subResources: SubResourceCaps[];
  /** Record-level (if-owner) restriction active for this role×module. */
  ifOwner: boolean;
  /** Whether this module supports owner scoping at all (drives the UI toggle). */
  ownerScopable: boolean;
  /** Effective field level for this role×module (>= SENSITIVE_FIELD_LEVEL = sees sensitive). */
  fieldLevel: number;
  /** Whether this module has a sensitive field tier (drives the UI toggle). */
  fieldScopable: boolean;
}
export interface RbacRoleView {
  key: string;
  name: string;
  rank: number;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  modules: RoleModuleCaps[];
}

/**
 * Full role catalog with each role's effective (default ⊕ org-override) capability
 * matrix and member count for one org — powers the settings/roles UI.
 */
export async function listRbacRoles(orgId: string): Promise<RbacRoleView[]> {
  const admin = supabaseAdmin();
  const [cat, orgCat, mrows, orows] = await Promise.all([
    admin.from('permission_roles').select('key, name, rank, description, is_system'),
    listOrgRoles(orgId),
    admin.from('member_roles').select('role_key').eq('org_id', orgId),
    admin
      .from('permission_rules')
      .select(
        'role_key, module, can_view, can_create, can_edit, can_delete, can_export, can_manage, if_owner, field_level',
      )
      .eq('org_id', orgId),
  ]);

  const counts = new Map<string, number>();
  for (const r of (mrows.data ?? []) as Array<{ role_key: string }>) {
    counts.set(r.role_key, (counts.get(r.role_key) ?? 0) + 1);
  }
  const ovr = new Map<string, ActionSet>();
  const ifOwnerMap = new Map<string, boolean>();
  const fieldLvlMap = new Map<string, number>();
  for (const r of (orows.data ?? []) as OverrideRow[]) {
    ovr.set(`${r.role_key}:${r.module}`, rowToActionSet(r));
    if (r.if_owner) ifOwnerMap.set(`${r.role_key}:${r.module}`, true);
    if (typeof r.field_level === 'number')
      fieldLvlMap.set(`${r.role_key}:${r.module}`, r.field_level);
  }

  type CatRow = {
    key: string;
    name: string;
    rank: number;
    description: string | null;
    is_system: boolean;
  };
  const allCat: CatRow[] = [
    ...((cat.data ?? []) as CatRow[]),
    ...orgCat.map((c) => ({
      key: c.key,
      name: c.name,
      rank: c.rank,
      description: null,
      is_system: false,
    })),
  ].sort((a, b) => b.rank - a.rank);
  return allCat.map((c) => ({
    key: c.key,
    name: c.name,
    rank: c.rank,
    description: c.description,
    isSystem: c.is_system,
    memberCount: counts.get(c.key) ?? 0,
    modules: MODULES.map((mod) => {
      const o = ovr.get(`${c.key}:${mod}`);
      const parentCaps = o ?? defaultCaps(c.key, mod);
      const subs: readonly SubResource[] = MODULE_SUBRESOURCES[mod] ?? [];
      return {
        module: mod,
        label: MODULE_LABELS[mod],
        caps: parentCaps,
        overridden: !!o,
        ifOwner: ifOwnerMap.get(`${c.key}:${mod}`) ?? false,
        ownerScopable: mod in OWNER_SCOPABLE_MODULES,
        fieldLevel: fieldLvlMap.get(`${c.key}:${mod}`) ?? defaultFieldLevel(mod),
        fieldScopable: mod in FIELD_LEVEL_MODULES,
        // Sub-resource caps: explicit override row if present, else inherit
        // the parent module's effective caps.
        subResources: subs.map((s) => {
          const so = ovr.get(`${c.key}:${s.key}`);
          return { key: s.key, label: s.label, caps: so ?? parentCaps, overridden: !!so };
        }),
      };
    }),
  }));
}

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'manager', 'staff', 'viewer'] as const;
export function isRoleKey(x: unknown): x is string {
  return typeof x === 'string' && (SYSTEM_ROLE_KEYS as readonly string[]).includes(x);
}

export interface RoleCatalogEntry {
  key: string;
  name: string;
  rank: number;
  description: string | null;
  isCustom?: boolean;
}

interface OrgRoleRow {
  key: string;
  name: string;
  rank: number;
  source_role_key: string | null;
}

/** This org's custom roles (org_roles), highest rank first. */
async function listOrgRoles(orgId: string): Promise<OrgRoleRow[]> {
  const { data } = await supabaseAdmin()
    .from('org_roles')
    .select('key, name, rank, source_role_key')
    .eq('org_id', orgId)
    .order('rank', { ascending: false });
  return (data ?? []) as OrgRoleRow[];
}

/**
 * The role catalog for one org (for assignment dropdowns): the 5 system roles
 * unioned with the org's custom roles, highest rank first.
 */
export async function listRoleCatalog(orgId: string): Promise<RoleCatalogEntry[]> {
  const [{ data: sys }, custom] = await Promise.all([
    supabaseAdmin().from('permission_roles').select('key, name, rank, description'),
    listOrgRoles(orgId),
  ]);
  const entries: RoleCatalogEntry[] = [
    ...((sys ?? []) as RoleCatalogEntry[]),
    ...custom.map((c) => ({
      key: c.key,
      name: c.name,
      rank: c.rank,
      description: null,
      isCustom: true,
    })),
  ];
  return entries.sort((a, b) => b.rank - a.rank);
}

/** A role key assignable in this org: a system role, or a custom role that org created. */
export async function isAssignableRoleKey(orgId: string, key: unknown): Promise<boolean> {
  if (isRoleKey(key)) return true;
  if (typeof key !== 'string') return false;
  const { data } = await supabaseAdmin()
    .from('org_roles')
    .select('key')
    .eq('org_id', orgId)
    .eq('key', key)
    .maybeSingle();
  return !!data;
}

/** Slugify a role name into the `custom-<slug>` key suffix. */
function slugifyRoleName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A role's rank, whether it's a system role or this org's custom role. Null if unknown. */
async function resolveRoleRank(orgId: string, roleKey: string): Promise<number | null> {
  if (isRoleKey(roleKey)) {
    const { data } = await supabaseAdmin()
      .from('permission_roles')
      .select('rank')
      .eq('key', roleKey)
      .maybeSingle();
    return (data as { rank: number } | null)?.rank ?? null;
  }
  const { data } = await supabaseAdmin()
    .from('org_roles')
    .select('rank')
    .eq('org_id', orgId)
    .eq('key', roleKey)
    .maybeSingle();
  return (data as { rank: number } | null)?.rank ?? null;
}

/**
 * The highest role rank the caller may create or grant in this org. Platform
 * admins (profiles.role='admin') and EXPLICIT system callers (system=true) are
 * uncapped; an org member is capped at their own highest role rank. Without this,
 * an org `admin` (whose default matrix already includes `users:manage`) could
 * clone or assign the higher-ranked `owner` role and escalate past owner-only
 * surfaces. Fails closed: a missing callerProfileId is treated as a hard error,
 * NOT as a trusted system caller (an HTTP request that reaches here without an
 * identity is a bug/auth gap, not a seed script).
 */
async function callerRankCap(
  orgId: string,
  callerProfileId: string | null,
  system = false,
): Promise<number> {
  if (system) return Number.MAX_SAFE_INTEGER; // explicit trusted internal/seed path — never inferred from a missing id
  if (!callerProfileId) throw error(403, 'Caller identity required to grant or clone roles.'); // fail closed
  const admin = supabaseAdmin();
  const { data: prof } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerProfileId)
    .maybeSingle();
  if ((prof as { role: string | null } | null)?.role === 'admin') return Number.MAX_SAFE_INTEGER; // platform superuser
  const { data: mr } = await admin
    .from('member_roles')
    .select('role_key')
    .eq('org_id', orgId)
    .eq('profile_id', callerProfileId);
  let roles = ((mr ?? []) as Array<{ role_key: string }>).map((r) => r.role_key);
  if (roles.length === 0) {
    const { data: om } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('profile_id', callerProfileId)
      .maybeSingle();
    roles = [legacyRoleKey((om as { role: string | null } | null)?.role)];
  }
  let cap = 0;
  for (const rk of roles) {
    const r = await resolveRoleRank(orgId, rk);
    if (r != null && r > cap) cap = r;
  }
  return cap;
}

/** Throws 403 when the caller may not create/grant a role of `targetRank`. */
async function assertMayGrantRank(
  orgId: string,
  callerProfileId: string | null,
  targetRank: number | null,
  verb: string,
  system = false,
): Promise<void> {
  const cap = await callerRankCap(orgId, callerProfileId, system);
  if ((targetRank ?? 0) > cap)
    throw error(403, `You cannot ${verb} a role that outranks your own.`);
}

/**
 * Create a custom role by duplicating `sourceRoleKey`: inserts the `org_roles`
 * catalog row (key `custom-<slug>`, same rank as the source) AND clones the
 * source role's EFFECTIVE per-module matrix into `permission_rules` overrides
 * for the new key, so it starts as an editable copy (the existing per-module
 * ladder UI then edits those rows same as any role).
 */
export async function createCustomRole(
  orgId: string,
  params: { sourceRoleKey: string; name: string },
  createdBy: string | null = null,
  system = false,
): Promise<RoleCatalogEntry> {
  const admin = supabaseAdmin();
  const name = params.name.trim();
  if (!name) throw error(400, 'name required');
  if (!(await isAssignableRoleKey(orgId, params.sourceRoleKey)))
    throw error(400, 'unknown sourceRoleKey');

  const slug = slugifyRoleName(name);
  if (!slug) throw error(400, 'name must contain at least one letter or digit');
  const key = `custom-${slug}`;

  const rank = await resolveRoleRank(orgId, params.sourceRoleKey);
  if (rank === null) throw error(400, 'unknown sourceRoleKey');
  // No self-escalation: can't clone a role that outranks the caller (e.g. an
  // org admin duplicating `owner`). Platform admins/system callers are uncapped.
  await assertMayGrantRank(orgId, createdBy, rank, 'duplicate', system);

  const { data: existing } = await admin
    .from('org_roles')
    .select('key')
    .eq('org_id', orgId)
    .eq('key', key)
    .maybeSingle();
  if (existing) throw error(409, 'A custom role with that name already exists.');

  const { data: rules } = await admin
    .from('permission_rules')
    .select(
      'module, can_view, can_create, can_edit, can_delete, can_export, can_manage, if_owner, field_level',
    )
    .eq('org_id', orgId)
    .eq('role_key', params.sourceRoleKey);
  const ovr = new Map<string, OverrideRow>();
  for (const r of (rules ?? []) as OverrideRow[]) ovr.set(r.module, r);

  for (const mod of MODULES) {
    const o = ovr.get(mod);
    const caps = o ? rowToActionSet(o) : defaultCaps(params.sourceRoleKey, mod);
    const ifOwner = o?.if_owner ?? false;
    const fieldLevel = o?.field_level ?? defaultFieldLevel(mod);
    await admin.from('permission_rules').upsert(
      {
        org_id: orgId,
        role_key: key,
        module: mod,
        can_view: caps.view,
        can_create: caps.create,
        can_edit: caps.edit,
        can_delete: caps.delete,
        can_export: caps.export,
        can_manage: caps.manage,
        if_owner: ifOwner,
        field_level: fieldLevel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,role_key,module' },
    );
  }

  await admin.from('org_roles').insert({
    org_id: orgId,
    key,
    name,
    rank,
    source_role_key: params.sourceRoleKey,
    created_by: createdBy,
  });

  return { key, name, rank, description: null, isCustom: true };
}

/**
 * Delete a custom role. Refuses (409) while any `member_roles` row in this org
 * still references it — unassign members first. 404s for a key this org never
 * created (including system role keys, which are never deletable).
 */
export async function deleteCustomRole(orgId: string, key: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: role } = await admin
    .from('org_roles')
    .select('key')
    .eq('org_id', orgId)
    .eq('key', key)
    .maybeSingle();
  if (!role) throw error(404, 'Custom role not found.');

  const { count } = await admin
    .from('member_roles')
    .select('profile_id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('role_key', key);
  if (count && count > 0)
    throw error(409, 'This role is still assigned to a member — remove it from them first.');

  await admin.from('permission_rules').delete().eq('org_id', orgId).eq('role_key', key);
  await admin.from('org_roles').delete().eq('org_id', orgId).eq('key', key);
}

/**
 * Each member's primary (highest-rank) role in an org → { profileId: roleKey }.
 * Used to show one role per user in the Team table.
 */
export async function getOrgMemberRoles(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin()
    .from('member_roles')
    .select('profile_id, role_key')
    .eq('org_id', orgId);
  const rank = new Map<string, number>(
    SYSTEM_ROLE_KEYS.map((k, i) => [k, SYSTEM_ROLE_KEYS.length - i]),
  );
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ profile_id: string; role_key: string }>) {
    const cur = out.get(r.profile_id);
    if (!cur || (rank.get(r.role_key) ?? 0) > (rank.get(cur) ?? 0))
      out.set(r.profile_id, r.role_key);
  }
  return out;
}

/**
 * Set a member's role in an org to exactly `roleKey` (single-role via the UI;
 * replaces any existing assignments for that member in that org).
 */
export async function setMemberRole(
  orgId: string,
  profileId: string,
  roleKey: string,
  grantedBy: string | null = null,
  system = false,
): Promise<void> {
  // No self-escalation: can't grant a role that outranks the caller.
  await assertMayGrantRank(
    orgId,
    grantedBy,
    await resolveRoleRank(orgId, roleKey),
    'assign',
    system,
  );
  const admin = supabaseAdmin();
  await admin.from('member_roles').delete().eq('org_id', orgId).eq('profile_id', profileId);
  await admin
    .from('member_roles')
    .insert({ org_id: orgId, profile_id: profileId, role_key: roleKey, granted_by: grantedBy });
}

/**
 * All roles per member in an org → { profileId: roleKey[] }. Powers the Team
 * page's multi-role chip UI (getOrgMemberRoles above stays as the primary-role
 * lookup other callers may still want).
 */
export async function getOrgMemberRolesAll(orgId: string): Promise<Map<string, string[]>> {
  const { data } = await supabaseAdmin()
    .from('member_roles')
    .select('profile_id, role_key')
    .eq('org_id', orgId);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as Array<{ profile_id: string; role_key: string }>) {
    const list = out.get(r.profile_id);
    if (list) list.push(r.role_key);
    else out.set(r.profile_id, [r.role_key]);
  }
  return out;
}

/**
 * Pure guard for `removeMemberRole`: true when stripping `roleKey` from
 * `profileId` would leave the org with zero owners. `ownerProfileIds` is every
 * profile currently holding the `owner` role in the org.
 */
export function wouldRemoveLastOwner(
  ownerProfileIds: string[],
  profileId: string,
  roleKey: string,
): boolean {
  return roleKey === 'owner' && ownerProfileIds.includes(profileId) && ownerProfileIds.length <= 1;
}

/**
 * Add one role to a member without disturbing their other roles (multi-role
 * assignment). No-ops if they already hold it (PK is org_id+profile_id+role_key).
 */
export async function addMemberRole(
  orgId: string,
  profileId: string,
  roleKey: string,
  grantedBy: string | null = null,
  system = false,
): Promise<void> {
  // No self-escalation: can't grant a role that outranks the caller.
  await assertMayGrantRank(
    orgId,
    grantedBy,
    await resolveRoleRank(orgId, roleKey),
    'assign',
    system,
  );
  await supabaseAdmin()
    .from('member_roles')
    .upsert(
      { org_id: orgId, profile_id: profileId, role_key: roleKey, granted_by: grantedBy },
      { onConflict: 'org_id,profile_id,role_key', ignoreDuplicates: true },
    );
}

/**
 * Remove one role from a member (multi-role assignment). Refuses to strip the
 * `owner` role from an org's last remaining owner — every org must keep at
 * least one owner.
 */
export async function removeMemberRole(
  orgId: string,
  profileId: string,
  roleKey: string,
): Promise<void> {
  if (roleKey === 'owner') {
    const { data } = await supabaseAdmin()
      .from('member_roles')
      .select('profile_id')
      .eq('org_id', orgId)
      .eq('role_key', 'owner');
    const owners = ((data ?? []) as Array<{ profile_id: string }>).map((o) => o.profile_id);
    if (wouldRemoveLastOwner(owners, profileId, roleKey)) {
      throw error(400, "Cannot remove the organization's last owner.");
    }
  }
  await supabaseAdmin()
    .from('member_roles')
    .delete()
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
    .eq('role_key', roleKey);
}

/**
 * Upsert a per-org capability override for (role, module-or-subresource). `module`
 * may be a top-level Module or a dotted sub-resource key (`crm.insights`). Caps are
 * normalized to the view-dependency invariant before storage.
 */
export async function setRoleOverride(
  orgId: string,
  roleKey: string,
  module: string,
  caps: ActionSet,
  ifOwner = false,
  fieldLevel?: number,
): Promise<void> {
  const admin = supabaseAdmin();
  const c = normalizeViewDependency(caps);
  await admin.from('permission_rules').upsert(
    {
      org_id: orgId,
      role_key: roleKey,
      module,
      can_view: c.view,
      can_create: c.create,
      can_edit: c.edit,
      can_delete: c.delete,
      can_export: c.export,
      can_manage: c.manage,
      // Owner-scoping only applies where there's an owner column; ignore the
      // flag for unsupported modules + sub-resources so it can't be set there.
      if_owner: ifOwner && module in OWNER_SCOPABLE_MODULES,
      // Field level only meaningful where the module has a sensitive tier;
      // default (full visibility) elsewhere. Omitted → preserve default.
      field_level: module in FIELD_LEVEL_MODULES ? (fieldLevel ?? defaultFieldLevel(module)) : 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,role_key,module' },
  );
}

/** Remove a per-org override so (role, module-or-subresource) reverts to default/inherited. */
export async function clearRoleOverride(
  orgId: string,
  roleKey: string,
  module: string,
): Promise<void> {
  const admin = supabaseAdmin();
  await admin
    .from('permission_rules')
    .delete()
    .eq('org_id', orgId)
    .eq('role_key', roleKey)
    .eq('module', module);
}

export function isModule(x: unknown): x is Module {
  return typeof x === 'string' && (MODULES as readonly string[]).includes(x);
}

const SUBRESOURCE_KEYS = new Set(ALL_SUBRESOURCES.map((s) => s.key));
/** True for a top-level Module OR a registered sub-resource key (`crm.insights`). */
export function isModuleOrSub(x: unknown): x is string {
  return isModule(x) || (typeof x === 'string' && SUBRESOURCE_KEYS.has(x));
}

/**
 * Non-throwing capability check (boolean) — for the central API write guard in
 * hooks, which returns a 403 Response rather than throwing a SvelteKit error.
 * Platform admins (profiles.role='admin', incl. dev AUTH_DISABLED) always pass;
 * an unauthenticated / org-less / no-supabaseId caller is denied (false).
 */
export async function hasOrgCapability(
  locals: App.Locals,
  module: Module,
  action: PermAction,
): Promise<boolean> {
  const user = locals.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!locals.tenantCtx || !user.supabaseId) return false;
  const caps = await resolveCapabilities(locals.tenantCtx.tenantId, user.supabaseId);
  return caps.can(module, action);
}

/**
 * Map an /api/<module>/* write request to the (module, action) capability it
 * requires, or `null` if the path isn't a gated business/config write. Single
 * source of truth for the central hooks guard.
 *
 * Method→action: DELETE→delete, POST collection creation→create, other
 * mutations→edit; the org-config surfaces
 * (modules + per-org plugin toggles) require `settings:manage`. Reads (GET/HEAD)
 * are NOT gated here — pages gate their own view access; this tranche closes the
 * write holes. `/api/scheduling/public/*` (anonymous booking) is excluded.
 */
const API_WRITE_PREFIXES: ReadonlyArray<readonly [string, Module]> = [
  ['/api/builder/agent-skills', 'agents'],
  ['/api/builder/agents', 'agents'],
  ['/api/builder/skills', 'agents'],
  ['/api/builder/tools', 'tools'],
  ['/api/crm', 'crm'],
  ['/api/finances', 'finance'],
  ['/api/sales', 'sales'],
  ['/api/scheduling', 'scheduling'],
  ['/api/support', 'support'],
  ['/api/memberships', 'memberships'],
  ['/api/brains', 'brains'],
  ['/api/stock', 'stock'],
  ['/api/meta', 'ads'],
  ['/api/pos', 'pos'],
  ['/api/projects', 'projects'],
  ['/api/project-tasks', 'projects'],
  ['/api/project-templates', 'projects'],
  ['/api/project-timesheets', 'projects'],
  ['/api/work', 'projects'],
  ['/api/workforce', 'projects'],
  ['/api/modules', 'settings'],
  ['/api/plugins', 'settings'],
];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CREATE_COLLECTION_ENDPOINTS = new Set([
  '/api/builder/agents',
  '/api/builder/skills',
  '/api/builder/tools',
]);

export function apiWriteCapability(
  pathname: string,
  method: string,
): { module: Module; action: PermAction } | null {
  if (!WRITE_METHODS.has(method)) return null;
  if (pathname.startsWith('/api/scheduling/public/')) return null; // anonymous booking
  let best: readonly [string, Module] | null = null;
  for (const entry of API_WRITE_PREFIXES) {
    const prefix = entry[0];
    if (
      (pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
      (!best || prefix.length > best[0].length)
    ) {
      best = entry;
    }
  }
  if (!best) return null;
  const module = best[1];
  const action: PermAction =
    module === 'settings'
      ? 'manage'
      : method === 'DELETE'
        ? 'delete'
        : method === 'POST' && CREATE_COLLECTION_ENDPOINTS.has(pathname)
          ? 'create'
          : 'edit';
  return { module, action };
}

/**
 * Gate a request on an RBAC capability in the caller's active org. Platform admins
 * (profiles.role='admin', incl. the dev AUTH_DISABLED bypass which has no
 * supabaseId) always pass; otherwise the user must hold the capability via their
 * org roles. Throws 401/403 SvelteKit errors. Returns the resolved caps on success.
 */
export async function requireOrgCapability(
  locals: App.Locals,
  module: Module,
  action: PermAction,
): Promise<Capabilities | null> {
  const user = locals.user;
  if (!user) throw error(401, 'Authentication required');
  if (user.role === 'admin') return null; // platform-admin superuser
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  if (!user.supabaseId) throw error(403, 'You do not have permission to manage roles.');
  const caps = await resolveCapabilities(locals.tenantCtx.tenantId, user.supabaseId);
  if (!caps.can(module, action)) throw error(403, 'You do not have permission to manage roles.');
  return caps;
}
