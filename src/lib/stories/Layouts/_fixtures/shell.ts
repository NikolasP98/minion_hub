// Dummy page.data for the app shell (layout load output for an owner of a
// business org). Invented names only — never real customer data.
import { ROUTE_ACCESS_RULES } from '$lib/routes/route-access-registry';

// An owner holds every page permission the route table names, plus the module verbs.
const PERMISSIONS = [
  ...new Set([
    ...ROUTE_ACCESS_RULES.flatMap((r) =>
      r.policyId.startsWith('permission:') ? [r.policyId.slice('permission:'.length)] : [],
    ),
    ...['crm', 'pos', 'stock', 'scheduling', 'finance', 'sales', 'agents', 'users'].flatMap((mod) =>
      ['view', 'create', 'edit', 'delete', 'manage'].map((a) => `${mod}:${a}`),
    ),
    'settings:view',
    'settings:manage',
    'pos:pending',
    'scheduling:data',
    'users:invite',
  ]),
];

export const USER = {
  id: 'u-demo-1',
  role: 'admin',
  email: 'ines.robles@example.com',
  displayName: 'Inés Robles',
};

export const shellData = {
  user: USER,
  permissions: { permissions: PERMISSIONS, roles: ['owner'] },
  activeOrgKind: 'business',
  activeOrgId: 'org-demo',
  organizations: [
    { id: 'org-demo', name: 'Clínica Alameda', slug: 'alameda', role: 'owner', kind: 'business' },
    { id: 'org-personal', name: 'Personal', slug: null, role: 'owner', kind: 'personal' },
  ],
  hosts: { servers: [], channels: [] },
  workspaces: [],
  env: { backend: 'dev' },
  schedulingEnabled: true,
  preferences: { preferences: {} },
};

/** Storybook page state for a route: the shell data plus route-specific data. */
export function pageAt(path: string, data: Record<string, unknown> = {}) {
  return {
    sveltekit_experimental: {
      state: { page: { url: new URL(`http://localhost${path}`), data: { ...shellData, ...data } } },
      // A fresh page load: nothing to go back to (back-nav reads `from`).
      navigation: { afterNavigate: { from: null, to: null, type: 'enter' } },
    },
  };
}

/** The real desktop frames run with the sidebar collapsed to its icon rail
 *  (`hub-sidebar-collapsed`, Sidebar.svelte); restored after the story. */
export function collapsedRail() {
  const key = 'hub-sidebar-collapsed';
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(key);
    localStorage.setItem(key, '1');
  } catch {
    return;
  }
  return () => {
    try {
      if (prev === null) localStorage.removeItem(key);
      else localStorage.setItem(key, prev);
    } catch {
      // storage unavailable: nothing to restore
    }
  };
}
