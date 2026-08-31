import type { OrgKind } from '$lib/org-kind';
import {
  MODULE_MANIFEST,
  resolveModuleForPath,
  isModuleAvailable,
  type ModuleAvailability,
  type ModuleId,
  type ModuleStates,
} from './availability';

/**
 * Pure decision helpers for the `(app)` route hook guard
 * (specs/2026-07-22-hub-routing-simplification-spec.md S2/R2). Extracted out
 * of hooks.server.ts's `finishApp` so the guard logic is unit-testable
 * without mocking a full SvelteKit `RequestEvent`.
 */

/**
 * Is this the request class the `(app)` guard applies to — an authenticated
 * browser-session page load under the `(app)` route group? Server-token/cron
 * requests never set `locals.user` (resolve-identity.ts's server-token
 * provider sets `bypassGate: true`, which skips `finishApp` entirely — this
 * check is belt-and-suspenders for anything that reaches it anyway), and
 * API/public routes have no `(app)` route id.
 */
export function isAppPageRequest(hasUser: boolean, routeId: string | null | undefined): boolean {
  return hasUser && Boolean(routeId?.startsWith('/(app)'));
}

/**
 * Module availability and RBAC permissions are organization-scoped. An
 * authenticated browser session can briefly exist without a tenant context while
 * the app layout repairs legacy or missing organization state. Let that layout
 * complete its recovery (or redirect the user to `/join`) instead of turning the
 * transient state into a raw 401/404 before the layout can run.
 */
export function shouldApplyOrganizationRouteGuards(
  hasUser: boolean,
  hasTenantContext: boolean,
  routeId: string | null | undefined,
): boolean {
  return hasTenantContext && isAppPageRequest(hasUser, routeId);
}

/** Does `moduleId` (or anything it `requires`) carry a `kinds` restriction? */
function isKindRestricted(moduleId: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(moduleId)) return false;
  seen.add(moduleId);
  const entry = MODULE_MANIFEST[moduleId as ModuleId] as ModuleAvailability | undefined;
  if (!entry) return false;
  if (entry.kinds) return true;
  return (entry.requires ?? []).some((dep) => isKindRestricted(dep, seen));
}

export type RouteGuardContext = {
  /**
   * Org kind resolved during identity resolution. Undefined/null means the
   * hook could not resolve it — this FAILS CLOSED below for kind-restricted
   * modules, unlike `isModuleAvailable`'s UI-only business-fallback
   * (org-kind.ts:13, characterized in availability.test.ts).
   */
  kind: OrgKind | undefined | null;
  moduleStates: ModuleStates;
};

/**
 * True when `canonicalPath` must 404 for this org (kind-restricted or
 * toggled-off module). Caller canonicalizes the path first (locale-strip
 * only, `$lib/canonical-path` — kept as a separate operation per R6).
 * Unmapped paths and unmanaged module ids always pass.
 */
export function isAppRouteBlocked(canonicalPath: string, ctx: RouteGuardContext): boolean {
  const match = resolveModuleForPath(canonicalPath);
  if (!match) return false;
  if (ctx.kind == null && isKindRestricted(match.moduleId)) return true;
  return !isModuleAvailable(match.moduleId, ctx);
}
