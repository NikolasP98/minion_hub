/** Curated bundle of super-admin-only views. Add one entry per super-only view. */
export const SUPER_VIEWS = [
  { key: 'reliability.monitor', route: '/reliability', navLabel: 'Reliability' },
  { key: 'orgs.all', route: '/orgs', navLabel: 'All Orgs' },
  { key: 'config.editor', route: '/config', navLabel: 'Config' },
  { key: 'terminal.shell', route: '/terminal', navLabel: 'Terminal' },
] as const;

export type SuperViewKey = (typeof SUPER_VIEWS)[number]['key'];
