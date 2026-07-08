import { error } from '@sveltejs/kit';
import { PERMISSIONS, ALL_SUBRESOURCES, BUSINESS_ACTION_MODULES } from '$lib/permissions';
import { resolveCapabilities, type Capabilities } from './rbac.service';
import type { LoadCtx } from './types';

export interface PermissionsLoadResult {
  permissions: string[];
}

/**
 * Legacy fallback: derive the permission set straight from profiles.role. Only
 * used now when there's no Supabase profile id to resolve RBAC caps from (admin →
 * all, everyone else → `*:view`). The primary path is RBAC (capsToLegacyPermissions).
 */
export function derivePermissionsFromRole(role: string | undefined): Set<string> {
  if (role === 'admin') return new Set(PERMISSIONS);
  return new Set(PERMISSIONS.filter((p) => p.endsWith(':view')));
}

/**
 * Bridge the RBAC capability engine to the legacy `resource:action` + `module:*`
 * permission vocabulary that the nav and page guards consume. Each legacy string
 * is mapped to the closest RBAC (module, action). Verified to preserve current
 * behaviour: owner/admin role → all perms (== old admin); manager → every `*:view`
 * + business edit (== old `user`, which got all `*:view`); viewer/staff → narrower.
 */
export function capsToLegacyPermissions(caps: Capabilities): string[] {
  const out: string[] = [];
  const add = (perm: string, ok: boolean) => {
    if (ok) out.push(perm);
  };
  add('agents:view', caps.can('agents', 'view'));
  add('agents:edit', caps.can('agents', 'edit'));
  add('agents:delete', caps.can('agents', 'delete'));
  add('sessions:view', caps.can('agents', 'view'));
  add('sessions:terminate', caps.can('agents', 'manage'));
  add('channels:view', caps.can('channels', 'view'));
  add('channels:configure', caps.can('channels', 'manage'));
  add('skills:view', caps.can('agents', 'view'));
  add('skills:install', caps.can('agents', 'manage'));
  add('settings:view', caps.can('settings', 'view'));
  add('settings:manage', caps.can('settings', 'manage'));
  add('users:view', caps.can('users', 'view'));
  add('users:invite', caps.can('users', 'create'));
  add('users:edit', caps.can('users', 'edit'));
  add('users:remove', caps.can('users', 'delete'));
  add('users:manage', caps.can('users', 'manage'));
  add('roles:view', caps.can('users', 'view'));
  add('roles:manage', caps.can('users', 'manage'));
  add('reliability:view', caps.can('reliability', 'view'));
  add('billing:view', caps.can('settings', 'view'));
  add('billing:manage', caps.can('settings', 'manage'));
  add('hosts:view', caps.can('settings', 'view'));
  add('hosts:manage', caps.can('settings', 'manage'));
  add('workshop:view', caps.can('agents', 'view'));
  add('workshop:edit', caps.can('agents', 'edit'));
  // business-module view gates (drive nav visibility + the central route guard)
  add('flows:view', caps.can('flows', 'view'));
  add('marketplace:view', caps.can('marketplace', 'view'));
  add('crm:view', caps.can('crm', 'view'));
  add('finance:view', caps.can('finance', 'view'));
  add('sales:view', caps.can('sales', 'view'));
  add('scheduling:view', caps.can('scheduling', 'view'));
  add('support:view', caps.can('support', 'view'));
  add('projects:view', caps.can('projects', 'view'));
  add('memberships:view', caps.can('memberships', 'view'));
  add('comms:view', caps.can('comms', 'view'));
  add('stock:view', caps.can('stock', 'view'));
  add('brains:view', caps.can('brains', 'view'));
  add('pos:view', caps.can('pos', 'view'));
  // section sub-resource view gates (inherit parent unless overridden)
  for (const s of ALL_SUBRESOURCES) add(`${s.key}:view`, caps.can(s.key, 'view'));
  // business action-level gates (create/edit/delete/export/manage), for
  // `canAct()` button-level client gating — mirrors the (module, action) pairs
  // `apiWriteCapability` (hooks.server.ts) enforces server-side.
  for (const m of BUSINESS_ACTION_MODULES) {
    add(`${m}:create`, caps.can(m, 'create'));
    add(`${m}:edit`, caps.can(m, 'edit'));
    add(`${m}:delete`, caps.can(m, 'delete'));
    add(`${m}:export`, caps.can(m, 'export'));
    add(`${m}:manage`, caps.can(m, 'manage'));
  }
  // nav module groups
  add('module:operations', caps.can('agents', 'view') || caps.can('channels', 'view'));
  add('module:workspace', caps.can('agents', 'view'));
  add('module:admin', caps.can('settings', 'view') || caps.can('users', 'view'));
  return out;
}

/**
 * Load the permission set for a given user, shaped exactly like the
 * `GET /api/users/me/permissions` response body. Callable from both
 * `+server.ts` and `+layout.server.ts`.
 *
 * Throws 401 if there is no tenant context (i.e. caller did not gate on
 * `requireAuth(locals)` / `locals.tenantCtx` first).
 */
export async function loadPermissionsForUser(
  ctx: LoadCtx,
  _userId: string,
): Promise<PermissionsLoadResult> {
  if (!ctx.tenantCtx) throw error(401, 'Authentication required');

  // Platform admins (profiles.role='admin', incl. the dev AUTH_DISABLED bypass
  // which has no supabaseId) keep full access — superuser short-circuit.
  if (ctx.user?.role === 'admin') return { permissions: [...PERMISSIONS] };

  // RBAC is now authoritative: resolve the user's org roles → capabilities →
  // legacy permission strings the nav + page guards consume. Falls back to the
  // role-derived set only when there's no Supabase profile to resolve from.
  const profileId = ctx.user?.supabaseId;
  if (!profileId) return { permissions: [...derivePermissionsFromRole(ctx.user?.role)] };

  const caps = await resolveCapabilities(ctx.tenantCtx.tenantId, profileId);
  return { permissions: capsToLegacyPermissions(caps) };
}
