import type { LabelHost } from './host-label';

/**
 * Narrow the host list to the org the user is acting as.
 *
 * `gateway.org_id` is a lease/assignment (per-org volume tenancy §3.4), so a
 * user linked to several orgs sees every gateway they can reach — which is how
 * two identically-named instances ended up side by side in the picker. Showing
 * only the active org's gateways is both less noisy and safer: picking the wrong
 * one provisions channels into another tenant.
 *
 * Two deliberate escape hatches, so this can never strand someone:
 *  - a host with NO org (shared pool) stays visible to everyone;
 *  - the currently-active host stays visible even if it belongs elsewhere,
 *    otherwise the pill would name a gateway absent from its own dropdown.
 * If the filter would empty the list, fall back to showing everything rather
 * than presenting a picker with nothing to pick.
 */
export function scopeHostsToOrg<T extends LabelHost>(
  hosts: T[],
  activeOrgId: string | null | undefined,
  activeHostId?: string | null,
): T[] {
  if (!activeOrgId) return hosts;
  const scoped = hosts.filter(
    (h) => !h.orgId || h.orgId === activeOrgId || h.id === activeHostId,
  );
  return scoped.length > 0 ? scoped : hosts;
}
