export const PERMISSIONS = [
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

export type Permission = (typeof PERMISSIONS)[number];

export function groupPermissions(): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of PERMISSIONS) {
    const [resource, action] = p.split(':');
    (groups[resource] ??= []).push(action);
  }
  return groups;
}

export function hasPermission(granted: ReadonlySet<string>, perm: Permission): boolean {
  return granted.has(perm);
}
