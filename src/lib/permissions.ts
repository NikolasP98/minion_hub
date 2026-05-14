export const RESOURCE_PERMISSIONS = [
  'agents:view', 'agents:edit', 'agents:delete',
  'sessions:view', 'sessions:terminate',
  'channels:view', 'channels:configure',
  'skills:view', 'skills:install',
  'settings:view', 'settings:manage',
  'users:view', 'users:invite', 'users:edit', 'users:remove',
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

export const PERMISSIONS = [...RESOURCE_PERMISSIONS, ...MODULE_PERMISSIONS] as const;

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
