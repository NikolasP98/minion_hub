import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';

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
	// platform / admin
	'agents',
	'channels',
	'flows',
	'marketplace',
	'reliability',
	'settings',
	'users',
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
	agents: 'Agents',
	channels: 'Channels',
	flows: 'Agent Builder',
	marketplace: 'Marketplace',
	reliability: 'Reliability',
	settings: 'Settings',
	users: 'Users & Team',
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
];
const ADMIN_MODULES: readonly Module[] = [
	'agents',
	'channels',
	'flows',
	'marketplace',
	'reliability',
	'settings',
	'users',
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
const ALL: ActionSet = { view: true, create: true, edit: true, delete: true, export: true, manage: true };
const RWXE = set({ view: true, create: true, edit: true, export: true });
const RWX = set({ view: true, create: true, edit: true });
const VIEW = set({ view: true });

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
			if (BUSINESS_MODULES.includes(module)) return RWXE; // full business data, no delete/manage
			if (ADMIN_MODULES.includes(module)) return VIEW;
			return NONE;
		case 'staff':
			if (['crm', 'scheduling', 'support', 'comms'].includes(module)) return RWX;
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
	/** Effective permission for a module+action across all of the member's roles. */
	can(module: Module, action: PermAction): boolean;
	/** True if the member can read ANY business module — the bar for analytics SQL. */
	canRunAnalytics(): boolean;
	/** Modules the member can at least view. */
	visibleModules(): Module[];
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
}

export function buildCapabilities(roles: string[], overrides: OverrideRow[]): Capabilities {
	const ovr = new Map<string, ActionSet>();
	for (const r of overrides) {
		ovr.set(`${r.role_key}:${r.module}`, {
			view: r.can_view,
			create: r.can_create,
			edit: r.can_edit,
			delete: r.can_delete,
			export: r.can_export,
			manage: r.can_manage,
		});
	}
	const effective = (roleKey: string, module: Module): ActionSet =>
		ovr.get(`${roleKey}:${module}`) ?? defaultCaps(roleKey, module);

	const can = (module: Module, action: PermAction): boolean =>
		roles.some((rk) => effective(rk, module)[action]);

	return {
		roles,
		can,
		canRunAnalytics: () => BUSINESS_MODULES.some((m) => can(m, 'view')),
		visibleModules: () => MODULES.filter((m) => can(m, 'view')),
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

	const { data: mr } = await admin
		.from('member_roles')
		.select('role_key')
		.eq('org_id', orgId)
		.eq('profile_id', profileId);
	let roles = ((mr ?? []) as Array<{ role_key: string }>).map((r) => r.role_key);

	if (roles.length === 0) {
		const { data: om } = await admin
			.from('organization_members')
			.select('role')
			.eq('organization_id', orgId)
			.eq('profile_id', profileId)
			.maybeSingle();
		roles = [legacyRoleKey((om as { role: string | null } | null)?.role)];
	}

	const { data: rules } = await admin
		.from('permission_rules')
		.select('role_key, module, can_view, can_create, can_edit, can_delete, can_export, can_manage')
		.eq('org_id', orgId)
		.in('role_key', roles);

	return buildCapabilities(roles, (rules ?? []) as OverrideRow[]);
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

export interface RoleModuleCaps {
	module: Module;
	label: string;
	caps: ActionSet;
	/** True when this org has a stored override for (role, module) — else it's the code default. */
	overridden: boolean;
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
	const [cat, mrows, orows] = await Promise.all([
		admin.from('permission_roles').select('key, name, rank, description, is_system').order('rank', { ascending: false }),
		admin.from('member_roles').select('role_key').eq('org_id', orgId),
		admin
			.from('permission_rules')
			.select('role_key, module, can_view, can_create, can_edit, can_delete, can_export, can_manage')
			.eq('org_id', orgId),
	]);

	const counts = new Map<string, number>();
	for (const r of (mrows.data ?? []) as Array<{ role_key: string }>) {
		counts.set(r.role_key, (counts.get(r.role_key) ?? 0) + 1);
	}
	const ovr = new Map<string, ActionSet>();
	for (const r of (orows.data ?? []) as OverrideRow[]) ovr.set(`${r.role_key}:${r.module}`, rowToActionSet(r));

	type CatRow = { key: string; name: string; rank: number; description: string | null; is_system: boolean };
	return ((cat.data ?? []) as CatRow[]).map((c) => ({
		key: c.key,
		name: c.name,
		rank: c.rank,
		description: c.description,
		isSystem: c.is_system,
		memberCount: counts.get(c.key) ?? 0,
		modules: MODULES.map((mod) => {
			const o = ovr.get(`${c.key}:${mod}`);
			return { module: mod, label: MODULE_LABELS[mod], caps: o ?? defaultCaps(c.key, mod), overridden: !!o };
		}),
	}));
}

/** Upsert a per-org capability override for (role, module). */
export async function setRoleOverride(
	orgId: string,
	roleKey: string,
	module: Module,
	caps: ActionSet,
): Promise<void> {
	const admin = supabaseAdmin();
	await admin.from('permission_rules').upsert(
		{
			org_id: orgId,
			role_key: roleKey,
			module,
			can_view: caps.view,
			can_create: caps.create,
			can_edit: caps.edit,
			can_delete: caps.delete,
			can_export: caps.export,
			can_manage: caps.manage,
			updated_at: new Date().toISOString(),
		},
		{ onConflict: 'org_id,role_key,module' },
	);
}

/** Remove a per-org override so (role, module) reverts to the code default. */
export async function clearRoleOverride(orgId: string, roleKey: string, module: Module): Promise<void> {
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
