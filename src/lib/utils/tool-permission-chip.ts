import { getPermissions } from '$lib/state/features/permissions.svelte';
import type { ToolPermission } from '$lib/types/tools';

/**
 * Whether the signed-in user's own capabilities cover a tool's RBAC permission,
 * per the legacy `module:action` strings already loaded client-side by the
 * canonical (app)/+layout.server.ts flow (no new fetch). Coverage is partial —
 * only BUSINESS_ACTION_MODULES/BUSINESS_PERMISSIONS emit legacy strings — so a
 * module outside that set (e.g. a future admin-only tool module) reads as
 * "denied" even when the user's role would actually pass server-side.
 * ponytail: acceptable false-negative on the client badge; the gateway's own
 * RBAC gate (fail-closed) is the real enforcement point, this is a UI hint.
 */
export function isToolPermissionAllowed(perm: ToolPermission): boolean {
  return getPermissions().has(`${perm.module}:${perm.action}`);
}

/** Display label for a tool permission chip, e.g. `crm.edit`. */
export function toolPermissionLabel(perm: ToolPermission): string {
  return `${perm.module}.${perm.action}`;
}
