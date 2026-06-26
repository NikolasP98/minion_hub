import { SUPER_VIEWS } from './super-views';
import type { UserRole } from '$server/auth/supabase-bridge';

type Capability = { minRole?: UserRole; permission?: string };

const ROLE_RANK: Record<UserRole, number> = { user: 0, admin: 1 };

const BASE_ACCESS: Record<string, Capability> = {
  'users.manage': { minRole: 'admin' },
  'agents.publish': { permission: 'marketplace:publish' },
  // Business-module view gates (RBAC-driven). Permission-based so the matrix is
  // authoritative; platform admins get every business `*:view` via the admin
  // short-circuit in loadPermissionsForUser, so they always pass.
  'crm.view': { permission: 'crm:view' },
  'finance.view': { permission: 'finance:view' },
  'sales.view': { permission: 'sales:view' },
  'scheduling.view': { permission: 'scheduling:view' },
  'support.view': { permission: 'support:view' },
  'memberships.view': { permission: 'memberships:view' },
  'projects.view': { permission: 'projects:view' },
  // Platform-module view gates (RBAC-driven).
  'agents.view': { permission: 'agents:view' },
  'channels.view': { permission: 'channels:view' },
  'flows.view': { permission: 'flows:view' },
  'marketplace.view': { permission: 'marketplace:view' },
};

/** Super-view keys auto-register as admin-only. */
const SUPER_ACCESS: Record<string, Capability> = Object.fromEntries(
  SUPER_VIEWS.map((v) => [v.key, { minRole: 'admin' }]),
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
