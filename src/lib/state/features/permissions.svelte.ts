import type { Permission } from '$lib/permissions';

let perms = $state(new Set<string>());
let loaded = $state(false);

export async function ensurePermissions() {
  if (loaded) return;
  const res = await fetch('/api/users/me/permissions');
  if (!res.ok) return;
  const data = (await res.json()) as { permissions: string[] };
  perms = new Set(data.permissions);
  loaded = true;
}

export function can(perm: Permission): boolean {
  return perms.has(perm);
}

export function getPermissions(): Set<string> {
  return perms;
}
