import { ACCESS, can } from '../access/policy';
import { requiredViewPermForPath } from '../permissions';

/**
 * Presentation code references an access-policy ID; it never repeats the
 * underlying permission. Existing RBAC and page guards remain authoritative
 * while this registry gives capture, navigation and validation code one
 * executable contract to consult.
 */
export type RouteAccessPolicyId =
  | 'public'
  | 'authenticated'
  | 'role:admin'
  | `permission:${string}`
  | `capability:${string}`
  | `org-capability:${string}:${string}`;

export interface RouteAccessContext {
  authenticated: boolean;
  role?: 'user' | 'admin';
  permissions?: ReadonlySet<string>;
  /** Action capabilities already resolved by the ERPNext-grade RBAC engine. */
  orgCapabilities?: ReadonlySet<string>;
}

export interface RouteAccessPolicy {
  id: RouteAccessPolicyId;
  description: string;
  evaluate(context: RouteAccessContext): boolean;
}

function authenticated(context: RouteAccessContext): boolean {
  return context.authenticated;
}

function policy(id: RouteAccessPolicyId): RouteAccessPolicy {
  if (id === 'public') {
    return { id, description: 'Available without a Hub session.', evaluate: () => true };
  }
  if (id === 'authenticated') {
    return { id, description: 'Requires an authenticated Hub session.', evaluate: authenticated };
  }
  if (id === 'role:admin') {
    return {
      id,
      description: 'Requires the existing platform-admin role guard.',
      evaluate: (context) => context.authenticated && context.role === 'admin',
    };
  }
  if (id.startsWith('permission:')) {
    const permission = id.slice('permission:'.length);
    return {
      id,
      description: `Requires the existing ${permission} route-view permission.`,
      evaluate: (context) => context.authenticated && Boolean(context.permissions?.has(permission)),
    };
  }
  if (id.startsWith('capability:')) {
    const capability = id.slice('capability:'.length);
    return {
      id,
      description: `Requires the existing ${capability} access capability.`,
      evaluate: (context) =>
        context.authenticated &&
        can(
          capability,
          context.role ? { role: context.role } : null,
          new Set(context.permissions ?? []),
        ),
    };
  }

  const [, module, action] = id.split(':');
  const capability = `${module}:${action}`;
  return {
    id,
    description: `Requires the existing ${module}.${action} organization capability.`,
    evaluate: (context) =>
      context.authenticated && Boolean(context.orgCapabilities?.has(capability)),
  };
}

const PAGE_POLICY_OVERRIDES: Readonly<Record<string, RouteAccessPolicyId>> = {
  '/brains/template': 'org-capability:brains:manage',
  '/cloud': 'org-capability:workspace:view',
  '/cloud/gui': 'org-capability:workspace:edit',
  '/cloud/settings': 'org-capability:workspace:manage',
  '/cloud/terminal': 'org-capability:workspace:edit',
  '/config': 'capability:config.editor',
  '/killswitches': 'capability:killswitches.view',
  '/notifications': 'role:admin',
  '/orgs': 'capability:orgs.all',
  '/settings/backups': 'org-capability:settings:manage',
  '/settings/gateways': 'role:admin',
  '/settings/modules': 'org-capability:settings:manage',
  '/settings/notifications': 'role:admin',
  '/settings/plugins': 'org-capability:settings:manage',
  '/settings/provision': 'org-capability:settings:manage',
  '/settings/roles': 'org-capability:users:manage',
  '/settings/team': 'org-capability:users:manage',
  '/settings/workflows': 'org-capability:settings:manage',
  '/team': 'capability:users.manage',
  '/users/join-requests': 'org-capability:users:manage',
};

const PUBLIC_PATTERNS = new Set([
  '/auth/reset',
  '/book/[slug]',
  '/invite/accept',
  '/login',
  '/login/forgot',
]);

/** Resolve the current route-view policy without changing any permission map. */
export function routeAccessPolicyIdForPattern(pattern: string): RouteAccessPolicyId {
  if (PUBLIC_PATTERNS.has(pattern)) return 'public';
  const override = PAGE_POLICY_OVERRIDES[pattern];
  if (override) return override;
  const permission = requiredViewPermForPath(pattern);
  return permission ? `permission:${permission}` : 'authenticated';
}

/**
 * Policy objects are materialized lazily so every permission/capability in the
 * existing registries can be referenced without maintaining a second list.
 */
export function getRouteAccessPolicy(id: RouteAccessPolicyId): RouteAccessPolicy {
  if (id.startsWith('capability:')) {
    const key = id.slice('capability:'.length);
    if (!(key in ACCESS)) throw new Error(`Unknown route access capability: ${key}`);
  }
  return policy(id);
}

export function isKnownRouteAccessPolicy(id: RouteAccessPolicyId): boolean {
  try {
    getRouteAccessPolicy(id);
    return true;
  } catch {
    return false;
  }
}

export const ROUTE_ACCESS_POLICY_OVERRIDES = PAGE_POLICY_OVERRIDES;
export const PUBLIC_ROUTE_PATTERNS = PUBLIC_PATTERNS;
