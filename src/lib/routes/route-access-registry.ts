/**
 * Serializable route-access registry.
 *
 * Keep this module free of Svelte, server-only imports, and executable auth
 * code. It is shared by the route manifest, server layout guard, client route
 * visibility, and compatibility adapters in `$lib/permissions`.
 */

export type RouteAccessPolicyId =
  | 'public'
  | 'authenticated'
  | 'role:admin'
  | `permission:${string}`
  | `capability:${string}`
  | `org-capability:${string}:${string}`;

export interface SubResource {
  /** Dotted module key, e.g. `crm.insights`. */
  key: string;
  label: string;
  /** Pathname prefix the sub-resource gates. */
  route: string;
}

/**
 * Gateable subpages nested under a parent module. This is also consumed by the
 * role-permission manager, so a route and its editable RBAC row cannot drift.
 */
export const MODULE_SUBRESOURCES: Readonly<Record<string, readonly SubResource[]>> = {
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
  ads: [{ key: 'ads.settings', label: 'Settings', route: '/socials/settings' }],
  pos: [
    { key: 'pos.sell', label: 'Sell', route: '/pos/sell' },
    { key: 'pos.appointments', label: 'Appointments', route: '/pos/appointments' },
    { key: 'pos.items', label: 'Catalog', route: '/pos/catalog' },
  ],
  workspace: [
    { key: 'workspace.gui', label: 'Remote Desktop', route: '/cloud/gui' },
    { key: 'workspace.terminal', label: 'Terminal', route: '/cloud/terminal' },
    { key: 'workspace.settings', label: 'Settings', route: '/cloud/settings' },
  ],
};

/** Flat list of every sub-resource (parent-key agnostic). */
export const ALL_SUBRESOURCES: readonly SubResource[] = Object.values(MODULE_SUBRESOURCES).flat();

export interface RouteAccessRule {
  /** Static route pattern or pathname prefix. */
  pattern: string;
  /** Exact route-pattern match or pathname-prefix match. */
  match: 'exact' | 'prefix';
  policyId: RouteAccessPolicyId;
  /** Preserve route-specific concealment semantics where they already exist. */
  deniedStatus?: 403 | 404;
}

/** Public route patterns. Dynamic segments are resolved for actual hrefs too. */
export const PUBLIC_ROUTE_PATTERNS = [
  '/auth/reset',
  '/book/[slug]',
  '/invite/accept',
  '/login',
  '/login/forgot',
] as const;

/**
 * Exact policies win over module prefixes. These correspond to route-owned
 * guards with stronger action/admin requirements than their parent module.
 */
export const ROUTE_ACCESS_POLICY_OVERRIDES: Readonly<Record<string, RouteAccessPolicyId>> = {
  '/brains/template': 'org-capability:brains:manage',
  '/cloud': 'org-capability:workspace:view',
  '/cloud/gui': 'org-capability:workspace:edit',
  '/cloud/settings': 'org-capability:workspace:manage',
  '/cloud/terminal': 'org-capability:workspace:edit',
  '/config': 'capability:config.editor',
  '/killswitches': 'capability:killswitches.view',
  '/notifications': 'role:admin',
  '/orgs': 'capability:orgs.all',
  '/settings/backups': 'org-capability:settings:manage',
  '/settings/gateways': 'role:admin',
  '/settings/modules': 'org-capability:settings:manage',
  '/settings/notifications': 'role:admin',
  '/settings/organizations': 'role:admin',
  '/settings/plugins': 'org-capability:settings:manage',
  '/settings/provision': 'org-capability:settings:manage',
  '/settings/roles': 'org-capability:users:manage',
  '/settings/team': 'org-capability:users:manage',
  '/settings/workflows': 'org-capability:settings:manage',
  '/team': 'capability:users.manage',
  '/users/join-requests': 'org-capability:users:manage',
};

const ROUTE_PERMISSION_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  // business modules
  ['/crm', 'crm:view'],
  ['/finances', 'finance:view'],
  ['/sales', 'sales:view'],
  ['/scheduling', 'scheduling:view'],
  ['/support', 'support:view'],
  ['/memberships', 'memberships:view'],
  ['/workforce', 'projects:view'],
  ['/stock', 'stock:view'],
  ['/brains', 'brains:view'],
  ['/socials', 'ads:view'],
  ['/pos', 'pos:view'],
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
  ['/cloud', 'workspace:view'],
  // Longest-prefix resolution lets these override their parent module.
  ...ALL_SUBRESOURCES.map((sub) => [sub.route, `${sub.key}:view`] as const),
];

export const ROUTE_ACCESS_RULES: readonly RouteAccessRule[] = [
  ...PUBLIC_ROUTE_PATTERNS.map((pattern): RouteAccessRule => ({
    pattern,
    match: 'exact',
    policyId: 'public',
  })),
  ...Object.entries(ROUTE_ACCESS_POLICY_OVERRIDES).map(([pattern, policyId]): RouteAccessRule => ({
    pattern,
    match: 'exact',
    policyId,
    deniedStatus: pattern === '/settings/gateways' ? 404 : 403,
  })),
  ...ROUTE_PERMISSION_PREFIXES.map(([pattern, permission]): RouteAccessRule => ({
    pattern,
    match: 'prefix',
    policyId: `permission:${permission}`,
  })),
];
