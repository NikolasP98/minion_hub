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
  /** Pathname prefix the sub-resource gates (exact pathname when `exact`). */
  route: string;
  /**
   * Gate only this exact pathname, not the subtree — a module's dashboard
   * (`/crm`) sits at the same prefix as the whole module, so it must be an
   * exact rule or it would shadow every sibling page.
   */
  exact?: true;
}

/** A module's landing dashboard as its own gateable row (owner ask 2026-09-17:
 *  "I might not want certain users to view the dashboards and instead see
 *  other subpages only"). Inherits the module's caps unless overridden, so
 *  nothing changes for existing roles until an admin unticks it. */
function dashboard(module: string, route: string): SubResource {
  return { key: `${module}.dashboard`, label: 'Dashboard', route, exact: true };
}

/**
 * Gateable subpages nested under a parent module. This is also consumed by the
 * role-permission manager, so a route and its editable RBAC row cannot drift.
 */
export const MODULE_SUBRESOURCES: Readonly<Record<string, readonly SubResource[]>> = {
  crm: [
    dashboard('crm', '/crm'),
    { key: 'crm.insights', label: 'Insights', route: '/crm/insights' },
    { key: 'crm.cleanup', label: 'Data Cleanup', route: '/crm/cleanup' },
    { key: 'crm.settings', label: 'Settings', route: '/crm/settings' },
  ],
  finance: [
    dashboard('finance', '/finances'),
    { key: 'finance.purchases', label: 'Purchases', route: '/finances/purchases' },
    { key: 'finance.settings', label: 'Settings', route: '/finances/settings' },
  ],
  scheduling: [
    dashboard('scheduling', '/scheduling'),
    { key: 'scheduling.event-types', label: 'Event Types', route: '/scheduling/event-types' },
    // People moved to /team (hub-team-hr-module spec S4); the sub-resource row keeps its key.
    { key: 'scheduling.resources', label: 'Team (HR)', route: '/team' },
    { key: 'scheduling.reminders', label: 'Reminders', route: '/scheduling/reminders' },
    { key: 'scheduling.settings', label: 'Settings', route: '/scheduling/settings' },
  ],
  ads: [
    dashboard('ads', '/socials'),
    { key: 'ads.settings', label: 'Settings', route: '/socials/settings' },
  ],
  stock: [
    dashboard('stock', '/stock'),
    { key: 'stock.items', label: 'Items', route: '/stock/items' },
    { key: 'stock.entries', label: 'Entries', route: '/stock/entries' },
    { key: 'stock.warehouses', label: 'Warehouses', route: '/stock/warehouses' },
    { key: 'stock.commitments', label: 'Commitments', route: '/stock/commitments' },
  ],
  projects: [dashboard('projects', '/workforce')],
  reliability: [dashboard('reliability', '/reliability')],
  marketplace: [dashboard('marketplace', '/marketplace')],
  pos: [
    { key: 'pos.sell', label: 'Sell', route: '/pos/sell' },
    { key: 'pos.appointments', label: 'Appointments', route: '/pos/appointments' },
    { key: 'pos.accounts', label: 'Client accounts', route: '/pos/accounts' },
    { key: 'pos.items', label: 'Catalog', route: '/pos/catalog' },
    { key: 'pos.settings', label: 'Settings', route: '/pos/settings' },
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
  '/brains/settings': 'org-capability:brains:manage',
  '/brains/template': 'org-capability:brains:manage',
  '/cloud': 'org-capability:workspace:view',
  '/cloud/gui': 'org-capability:workspace:edit',
  '/cloud/settings': 'org-capability:workspace:manage',
  '/cloud/terminal': 'org-capability:workspace:edit',
  '/config': 'capability:config.editor',
  '/killswitches': 'capability:killswitches.view',
  '/notifications': 'role:admin',
  '/orgs': 'capability:orgs.all',
  // Write surfaces nested under a view-gated module: the module prefix and
  // MODULE_SUBRESOURCES both stop at `:view`, so without these overrides a
  // viewer (who has every `*:view` cap, including the subresource's) could
  // open the page. Action-level overrides close that (server write APIs are
  // gated separately — see requireOrgCapability calls under src/routes/api).
  '/pos/sell': 'org-capability:pos:create',
  '/pos/settings': 'org-capability:pos:manage',
  '/pos/appointments/new': 'org-capability:pos:create',
  '/stock/entries/new': 'org-capability:stock:create',
  '/settings/backups': 'org-capability:settings:manage',
  '/settings/gateways': 'role:admin',
  '/settings/modules': 'org-capability:settings:manage',
  '/settings/notifications': 'role:admin',
  '/settings/organizations': 'role:admin',
  '/settings/plugins': 'org-capability:settings:manage',
  '/settings/provision': 'org-capability:settings:manage',
  '/settings/roles': 'org-capability:users:manage',
  '/settings/tables': 'org-capability:settings:manage',
  '/settings/team': 'org-capability:users:manage',
  '/settings/workflows': 'org-capability:settings:manage',
  // HR tabs (roster, availability, time off, holidays) — spec O3 decision; the
  // Members & access tab is gated client-side by users.manage.
  '/team': 'permission:scheduling:view',
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
  ['/pulse', 'pulse:view'],
  // "My Work" is the personal view over project tasks — same module as
  // /workforce (its writes already route to `projects` via API_WRITE_PREFIXES).
  ['/work', 'projects:view'],
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
  ...ALL_SUBRESOURCES.filter((sub) => !sub.exact).map(
    (sub) => [sub.route, `${sub.key}:view`] as const,
  ),
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
  // Module dashboards: exact rules so `/crm` needs `crm.dashboard:view` while
  // `/crm/customers` keeps resolving to the `crm:view` prefix.
  ...ALL_SUBRESOURCES.filter((sub) => sub.exact).map((sub): RouteAccessRule => ({
    pattern: sub.route,
    match: 'exact',
    policyId: `permission:${sub.key}:view`,
  })),
];
