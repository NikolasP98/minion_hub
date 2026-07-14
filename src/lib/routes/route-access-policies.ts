import { ACCESS, can } from '../access/policy';
import {
  PUBLIC_ROUTE_PATTERNS,
  ROUTE_ACCESS_POLICY_OVERRIDES,
  ROUTE_ACCESS_RULES,
  type RouteAccessPolicyId,
  type RouteAccessRule,
} from './route-access-registry';

export type { RouteAccessPolicyId, RouteAccessRule } from './route-access-registry';

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

export interface ResolvedRouteAccess {
  policyId: RouteAccessPolicyId;
  /** The matching explicit rule, absent for the authenticated fallback. */
  rule: RouteAccessRule | null;
  deniedStatus: 403 | 404;
}

export interface RouteAccessDecision extends ResolvedRouteAccess {
  allowed: boolean;
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
      context.authenticated &&
      Boolean((context.orgCapabilities ?? context.permissions)?.has(capability)),
  };
}

function pathnameOnly(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || '/';
  if (pathname === '/') return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function patternMatches(pattern: string, pathname: string): boolean {
  const patternSegments = pathnameOnly(pattern).split('/').filter(Boolean);
  const pathSegments = pathnameOnly(pathname).split('/').filter(Boolean);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index];
    if (segment.startsWith('[...') && segment.endsWith(']')) return true;
    if (index >= pathSegments.length) return false;
    if (segment.startsWith('[') && segment.endsWith(']')) continue;
    if (segment !== pathSegments[index]) return false;
  }
  return patternSegments.length === pathSegments.length;
}

function ruleMatches(rule: RouteAccessRule, candidate: string): boolean {
  const path = pathnameOnly(candidate);
  if (rule.match === 'exact') return patternMatches(rule.pattern, path);
  const prefix = pathnameOnly(rule.pattern);
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Resolve a static route pattern or live href/pathname through one authority.
 * Exact policies beat prefix policies; otherwise the longest prefix wins.
 * Unknown app paths fail back to authenticated rather than becoming public.
 */
export function resolveRouteAccess(path: string): ResolvedRouteAccess {
  let best: RouteAccessRule | null = null;
  for (const rule of ROUTE_ACCESS_RULES) {
    if (!ruleMatches(rule, path)) continue;
    if (
      !best ||
      (rule.match === 'exact' && best.match !== 'exact') ||
      (rule.match === best.match && rule.pattern.length > best.pattern.length)
    ) {
      best = rule;
    }
  }
  return {
    policyId: best?.policyId ?? 'authenticated',
    rule: best,
    deniedStatus: best?.deniedStatus ?? 403,
  };
}

/** Resolve the policy for either a manifest pattern or a live pathname/href. */
export function routeAccessPolicyIdForPattern(pattern: string): RouteAccessPolicyId {
  return resolveRouteAccess(pattern).policyId;
}

export function routeAccessPolicyIdForPath(pathname: string): RouteAccessPolicyId {
  return resolveRouteAccess(pathname).policyId;
}

/** Evaluate a known policy against already-loaded auth/RBAC data. */
export function evaluateRouteAccessPolicy(
  id: RouteAccessPolicyId,
  context: RouteAccessContext,
): boolean {
  return getRouteAccessPolicy(id).evaluate(context);
}

export function decideRouteAccess(path: string, context: RouteAccessContext): RouteAccessDecision {
  const resolved = resolveRouteAccess(path);
  return {
    ...resolved,
    allowed: evaluateRouteAccessPolicy(resolved.policyId, context),
  };
}

/** Resolve and evaluate in one call for server guards and client visibility. */
export function canAccessRoute(path: string, context: RouteAccessContext): boolean {
  return decideRouteAccess(path, context).allowed;
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

export { PUBLIC_ROUTE_PATTERNS, ROUTE_ACCESS_POLICY_OVERRIDES };
