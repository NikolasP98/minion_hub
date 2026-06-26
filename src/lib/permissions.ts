export const RESOURCE_PERMISSIONS = [
  'agents:view', 'agents:edit', 'agents:delete',
  'sessions:view', 'sessions:terminate',
  'channels:view', 'channels:configure',
  'skills:view', 'skills:install',
  'settings:view', 'settings:manage',
  'users:view', 'users:invite', 'users:edit', 'users:remove', 'users:manage',
  'roles:view', 'roles:manage',
  'billing:view', 'billing:manage',
  'hosts:view', 'hosts:manage',
  'workshop:view', 'workshop:edit',
] as const;

export type ModuleKey = 'operations' | 'workspace' | 'admin';

export const MODULES: Record<ModuleKey, { label: string; description: string; resources: string[] }> = {
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
] as const;

/**
 * Platform-module view permissions not already in RESOURCE_PERMISSIONS
 * (agents/channels/settings/users live there). Emitted from caps so the agents
 * surface, Agent Builder, and Marketplace nav + routes gate off the matrix.
 */
export const PLATFORM_VIEW_PERMISSIONS = ['flows:view', 'marketplace:view', 'reliability:view'] as const;

/**
 * Section sub-resources: gateable subpages nested under a parent module in the
 * Role Permission Manager. The `key` is a dotted module key (`crm.insights`) and
 * is what gets stored in permission_rules + checked by the engine; a sub-resource
 * INHERITS its parent module's caps unless explicitly overridden (see
 * rbac.service `buildCapabilities`). Single source of truth for: the role-manager
 * expandable rows, the sub view permission vocabulary, and the central route
 * guard's subpage mapping below.
 */
export interface SubResource {
  /** Dotted module key, e.g. `crm.insights`. */
  key: string;
  label: string;
  /** Pathname prefix the sub-resource gates. */
  route: string;
}
export const MODULE_SUBRESOURCES: Record<string, SubResource[]> = {
  crm: [
    { key: 'crm.insights', label: 'Insights', route: '/crm/insights' },
    { key: 'crm.cleanup', label: 'Data Cleanup', route: '/crm/cleanup' },
    { key: 'crm.settings', label: 'Settings', route: '/crm/settings' },
  ],
  finance: [
    { key: 'finance.products', label: 'Products', route: '/finances/products' },
    { key: 'finance.settings', label: 'Settings', route: '/finances/settings' },
  ],
  scheduling: [
    { key: 'scheduling.event-types', label: 'Event Types', route: '/scheduling/event-types' },
    { key: 'scheduling.resources', label: 'Resources', route: '/scheduling/resources' },
    { key: 'scheduling.reminders', label: 'Reminders', route: '/scheduling/reminders' },
    { key: 'scheduling.settings', label: 'Settings', route: '/scheduling/settings' },
  ],
};

/** Flat list of every sub-resource (parent-key agnostic). */
export const ALL_SUBRESOURCES: SubResource[] = Object.values(MODULE_SUBRESOURCES).flat();

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

export const PERMISSIONS = [
  ...RESOURCE_PERMISSIONS,
  ...BUSINESS_PERMISSIONS,
  ...PLATFORM_VIEW_PERMISSIONS,
  ...SUBRESOURCE_VIEW_PERMISSIONS,
  ...MODULE_PERMISSIONS,
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
 * `/terminal`, `/config`, `/orgs` stay platform-admin super-views.
 */
const ROUTE_VIEW_PERMS: ReadonlyArray<readonly [string, string]> = [
  // business modules
  ['/crm', 'crm:view'],
  ['/finances', 'finance:view'],
  ['/sales', 'sales:view'],
  ['/scheduling', 'scheduling:view'],
  ['/support', 'support:view'],
  ['/memberships', 'memberships:view'],
  ['/workforce', 'projects:view'],
  // platform modules
  ['/agents', 'agents:view'],
  ['/capabilities', 'agents:view'],
  ['/tools', 'agents:view'],
  ['/prompt', 'agents:view'],
  ['/sessions', 'agents:view'],
  ['/flow-editor', 'flows:view'],
  ['/channels', 'channels:view'],
  ['/marketplace', 'marketplace:view'],
  ['/reliability', 'reliability:view'],
  // section sub-resources (longest-prefix wins, so these override the parent
  // module entry for their subpath — e.g. /crm/insights -> crm.insights:view)
  ...ALL_SUBRESOURCES.map((s) => [s.route, `${s.key}:view`] as const),
];

export function requiredViewPermForPath(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of ROUTE_VIEW_PERMS) {
    const prefix = entry[0];
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) {
      best = entry;
    }
  }
  return best ? best[1] : null;
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
