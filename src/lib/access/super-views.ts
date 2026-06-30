/** Curated bundle of super-admin-only views. Add one entry per super-only view. */
export const SUPER_VIEWS = [
  // reliability.monitor migrated to RBAC (permission `reliability:view`, gated by
  // the matrix) — see policy.ts BASE_ACCESS + permissions.ts ROUTE_VIEW_PERMS.
  { key: 'orgs.all', route: '/orgs', navLabel: 'All Orgs' },
  { key: 'config.editor', route: '/config', navLabel: 'Config' },
  { key: 'terminal.shell', route: '/terminal', navLabel: 'Terminal' },
  { key: 'killswitches.view', route: '/killswitches', navLabel: 'Kill Switches' },
] as const;

export type SuperViewKey = (typeof SUPER_VIEWS)[number]['key'];
