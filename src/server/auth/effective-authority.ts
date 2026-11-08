import { AsyncLocalStorage } from 'node:async_hooks';
import { error } from '@sveltejs/kit';
import { RBAC_BUSINESS_MODULES } from '$lib/permissions';
import type { Capabilities } from '$server/services/rbac.service';

export interface EffectiveAuthority {
  profileId: string;
  actorName?: string | null;
  orgId: string;
  roleKey: string;
  generation: string;
  rank: number;
  invalid: boolean;
  capabilities: Capabilities;
}
export interface RequestCapabilityScope {
  /** Verified platform administrators retain their ordinary superuser bypass. */
  platformAdmin?: boolean;
  orgId: string;
  profileId: string;
  capabilities: Capabilities;
}
const requestCapabilities = new AsyncLocalStorage<RequestCapabilityScope | undefined>();
export function runWithRequestCapabilities<T>(
  scope: RequestCapabilityScope | undefined,
  fn: () => T,
): T {
  return requestCapabilities.run(scope, fn);
}
export function currentRequestCapabilities(
  orgId: string,
  profileId: string,
): Capabilities | undefined {
  return currentRequestAuthority(orgId, profileId)?.capabilities;
}
/** Exact actor matching; org-only legacy setters bind to the admitted request actor. */
export function currentRequestAuthority(
  orgId: string,
  profileId?: string,
): RequestCapabilityScope | undefined {
  const scope = requestCapabilities.getStore();
  return scope?.orgId === orgId && (!profileId || scope.profileId === profileId)
    ? scope
    : undefined;
}
const authority = new AsyncLocalStorage<EffectiveAuthority | undefined>();
export function runWithEffectiveAuthority<T>(
  scope: EffectiveAuthority | undefined,
  fn: () => T,
): T {
  return authority.run(scope, fn);
}
/** Never apply the browser actor's role to another member/organization lookup. */
export function currentEffectiveAuthority(
  orgId: string,
  profileId: string,
): EffectiveAuthority | undefined {
  const scope = authority.getStore();
  return scope?.orgId === orgId && scope.profileId === profileId ? scope : undefined;
}
export function simulationAuditContext(orgId: string, profileId: string | null) {
  const scope = authority.getStore();
  return scope?.orgId === orgId && (!profileId || scope.profileId === profileId)
    ? scope
    : undefined;
}
/** ALS cannot cross an independently signed credential or deferred job boundary. */
export function rejectSimulatedDelegation(): void {
  if (authority.getStore()) {
    throw error(403, {
      code: 'simulation_delegation_unavailable',
      message:
        'This action is unavailable during role simulation. Finish simulation from your avatar menu to continue.',
    });
  }
}
export function isSimulating(): boolean {
  return Boolean(authority.getStore());
}

/** Fresh policy may narrow an admitted request, but cannot add authority mid-request. */
export function narrowAdmittedCapabilities(
  fresh: Capabilities,
  admitted: Capabilities,
): Capabilities {
  return {
    roles: [...fresh.roles],
    can: (module, action) => fresh.can(module, action) && admitted.can(module, action),
    canRunAnalytics: () =>
      RBAC_BUSINESS_MODULES.some((m) => fresh.can(m, 'view') && admitted.can(m, 'view')),
    visibleModules: () => fresh.visibleModules().filter((m) => admitted.can(m, 'view')),
    ownerScoped: (module) => fresh.ownerScoped(module) || admitted.ownerScoped(module),
    fieldLevel: (module) => Math.min(fresh.fieldLevel(module), admitted.fieldLevel(module)),
    explicitView: (key) => {
      const current = fresh.explicitView(key),
        ceiling = admitted.explicitView(key);
      if (current === false || ceiling === false) return false;
      // A newly granted page must wait for the next admitted request/reload.
      return current === true && ceiling !== true ? false : current;
    },
  };
}
