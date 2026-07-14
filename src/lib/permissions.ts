import { ALL_SUBRESOURCES } from '$lib/routes/route-access-registry';
import { routeAccessPolicyIdForPath } from '$lib/routes/route-access-policies';

export const RESOURCE_PERMISSIONS = [
  'agents:view',
  'agents:edit',
  'agents:delete',
  'sessions:view',
  'sessions:terminate',
  'channels:view',
  'channels:configure',
  'skills:view',
  'skills:install',
  'settings:view',
  'settings:manage',
  'users:view',
  'users:invite',
  'users:edit',
  'users:remove',
  'users:manage',
  'roles:view',
  'roles:manage',
  'billing:view',
  'billing:manage',
  'hosts:view',
  'hosts:manage',
  'workshop:view',
  'workshop:edit',
] as const;

export type ModuleKey = 'operations' | 'workspace' | 'admin';

export const MODULES: Record<
  ModuleKey,
  { label: string; description: string; resources: string[] }
> = {
  operations: {
    label: 'Operations',
    description: 'Day-to-day monitoring of running agents and conversations.',
    resources: ['agents', 'sessions', 'channels'],
  },
  workspace: {
    label: 'Workspace',
    description: 'Authoring surfaces — workshop canvas and skill library.',
    resources: ['workshop', 'skills'],
  },
  admin: {
    label: 'Admin',
    description: 'Tenant administration — users, roles, billing, hosts, settings.',
    resources: ['users', 'roles', 'settings', 'billing', 'hosts'],
  },
};

export const MODULE_PERMISSIONS = (Object.keys(MODULES) as ModuleKey[]).map(
  (k) => `module:${k}` as const,
);

/**
 * Business-data view permissions, emitted from the RBAC engine
 * (`capsToLegacyPermissions`) so the nav + central route guard can gate the
 * business modules the same way platform resources are gated. `finance:view`
 * keeps the singular module key (route is /finances); `projects:view` backs the
 * /workforce subtree.
 */
export const BUSINESS_PERMISSIONS = [
  'crm:view',
  'finance:view',
  'sales:view',
  'scheduling:view',
  'support:view',
  'projects:view',
  'memberships:view',
  'comms:view',
  'stock:view',
  'brains:view',
  'ads:view',
  'pos:view',
] as const;

/**
 * Platform-module view permissions not already in RESOURCE_PERMISSIONS
 * (agents/channels/settings/users live there). Emitted from caps so the agents
 * surface, Agent Builder, and Marketplace nav + routes gate off the matrix.
 */
export const PLATFORM_VIEW_PERMISSIONS = [
  'flows:view',
  'marketplace:view',
  'reliability:view',
  'workspace:view',
] as const;

/** Interactive cloud sessions and destructive lifecycle controls are stronger
 * than module visibility, so they keep action-level permissions. */
export const WORKSPACE_ACTION_PERMISSIONS = [
  'workspace:edit',
  'workspace:delete',
  'workspace:manage',
] as const;

/**
 * Section sub-resources: gateable subpages nested under a parent module in the
 * Role Permission Manager. The `key` is a dotted module key (`crm.insights`) and
 * is what gets stored in permission_rules + checked by the engine; a sub-resource
 * INHERITS its parent module's caps unless explicitly overridden (see
 * rbac.service `buildCapabilities`). The serializable route registry is the
 * source of truth for the role-manager rows, sub-view vocabulary, and guards.
 */
export {
  ALL_SUBRESOURCES,
  MODULE_SUBRESOURCES,
  type SubResource,
} from '$lib/routes/route-access-registry';

/**
 * Field-level (ERPNext "permission level") modules: those with a sensitive field
 * tier that can be hidden from a role. A role's `field_level` on the module must
 * be >= SENSITIVE_FIELD_LEVEL to read these fields; otherwise the owning service
 * masks them. Default level is 1 for every role (full visibility preserved — the
 * masking is opt-in by lowering a role to 0).
 */
export const SENSITIVE_FIELD_LEVEL = 1;
export const FIELD_LEVEL_MODULES: Record<string, { label: string; hint: string }> = {
  crm: { label: 'Contact PII', hint: 'phone numbers & email addresses' },
  finance: { label: 'Cost & margin', hint: 'discount rate & margin figures' },
  scheduling: { label: 'Attendee PII', hint: 'attendee phone numbers & emails' },
};

/** `<subkey>:view` for every sub-resource — emitted from caps + gated on routes. */
export const SUBRESOURCE_VIEW_PERMISSIONS = ALL_SUBRESOURCES.map((s) => `${s.key}:view`);

/**
 * Business modules that get action-level legacy perms (`<module>:create|edit|
 * delete|export|manage`), emitted from `capsToLegacyPermissions` so `canAct()`
 * can gate individual write affordances (buttons) the same way `apiWriteCapability`
 * (hooks.server.ts) gates the write API for that module.
 */
export const BUSINESS_ACTION_MODULES = [
  'crm',
  'finance',
  'sales',
  'scheduling',
  'support',
  'projects',
  'memberships',
  'comms',
  'stock',
  'brains',
  'ads',
  'pos',
] as const;
const BUSINESS_ACTIONS = ['create', 'edit', 'delete', 'export', 'manage'] as const;
export const BUSINESS_ACTION_PERMISSIONS = BUSINESS_ACTION_MODULES.flatMap((m) =>
  BUSINESS_ACTIONS.map((a) => `${m}:${a}` as const),
);

export const PERMISSIONS = [
  ...RESOURCE_PERMISSIONS,
  ...BUSINESS_PERMISSIONS,
  ...PLATFORM_VIEW_PERMISSIONS,
  ...WORKSPACE_ACTION_PERMISSIONS,
  ...SUBRESOURCE_VIEW_PERMISSIONS,
  ...MODULE_PERMISSIONS,
  ...BUSINESS_ACTION_PERMISSIONS,
] as const;

/**
 * Map an (app) pathname to the module view permission it requires, or `null` if
 * the route isn't gated. Single source of truth for the central layout guard
 * (server enforcement) and the nav `requires` keys (UX hiding) so they can never
 * drift. Longest prefix wins.
 *
 * Deliberately NOT gated here: `/settings` (holds personal preferences everyone
 * needs; its org-config subroutes + write APIs gate themselves), `/team` + `/users`
 * (own RBAC guards via requireOrgCapability), `/home` + `/overview` (universal).
 * `/config` and `/orgs` stay platform-admin super-views.
 */
export function requiredViewPermForPath(pathname: string): string | null {
  // Compatibility adapter for services and tests that still need the legacy
  // permission string. Route access itself is resolved by the policy registry.
  const policyId = routeAccessPolicyIdForPath(pathname);
  return policyId.startsWith('permission:') ? policyId.slice('permission:'.length) : null;
}

export type Permission = (typeof PERMISSIONS)[number];

export function groupPermissions(): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of RESOURCE_PERMISSIONS) {
    const [resource, action] = p.split(':');
    (groups[resource] ??= []).push(action);
  }
  return groups;
}

export function hasPermission(granted: ReadonlySet<string>, perm: Permission): boolean {
  return granted.has(perm);
}

/**
 * Resolve which modules a role exposes in nav.
 *
 * Why: existing roles predating modules have no `module:*` perms — falling back to
 * derive-from-view keeps them functional. Once any module perm is set, that becomes
 * authoritative.
 */
export function effectiveModules(granted: ReadonlySet<string>): Set<ModuleKey> {
  const explicit = MODULE_PERMISSIONS.filter((p) => granted.has(p));
  if (explicit.length > 0) {
    return new Set(explicit.map((p) => p.split(':')[1] as ModuleKey));
  }
  const out = new Set<ModuleKey>();
  for (const [key, mod] of Object.entries(MODULES) as [ModuleKey, (typeof MODULES)[ModuleKey]][]) {
    if (mod.resources.some((r) => granted.has(`${r}:view`))) out.add(key);
  }
  return out;
}
