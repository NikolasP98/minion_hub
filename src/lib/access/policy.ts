import { SUPER_VIEWS } from './super-views';
import type { UserRole } from '$server/auth/supabase-bridge';

type Capability = { minRole?: UserRole; permission?: string };

const ROLE_RANK: Record<UserRole, number> = { user: 0, admin: 1, super_admin: 2 };

const BASE_ACCESS: Record<string, Capability> = {
  'users.manage': { minRole: 'admin' },
  'agents.publish': { permission: 'marketplace:publish' },
};

/** Super-view keys auto-register as super_admin-only. */
const SUPER_ACCESS: Record<string, Capability> = Object.fromEntries(
  SUPER_VIEWS.map((v) => [v.key, { minRole: 'super_admin' }]),
);

export const ACCESS: Record<string, Capability> = { ...BASE_ACCESS, ...SUPER_ACCESS };

/** Pure capability check. `perms` is the user's permission-string set. */
export function can(key: string, user?: { role: UserRole } | null, perms?: Set<string>): boolean {
  const cap = ACCESS[key];
  if (!cap) return false;
  const rank = ROLE_RANK[user?.role ?? 'user'];
  if (cap.minRole && rank >= ROLE_RANK[cap.minRole]) return true;
  if (cap.permission && perms?.has(cap.permission)) return true;
  return false;
}

/** Route → required access key, derived from SUPER_VIEWS (for server guards). */
export const ROUTE_ACCESS: Record<string, string> = Object.fromEntries(
  SUPER_VIEWS.map((v) => [v.route, v.key]),
);
