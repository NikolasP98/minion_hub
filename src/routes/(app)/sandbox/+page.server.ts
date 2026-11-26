import type { PageServerLoad } from './$types';
import type { WiringReport } from '$lib/sandbox/wiring-types';
import { requireOrgCapability } from '$server/services/rbac.service';

/** Admin-only POC surface (`route-access-registry`: `/sandbox` → `org-capability:settings:manage` (org admins; platform admins always pass)). */
export const load: PageServerLoad = async ({ locals, fetch }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  // TODO(handoff): swap for `listElements` from $server/sandbox/sandbox.service
  // once S1 lands — the service is owned by the data slice and does not exist yet.
  const res = await fetch('/api/sandbox/elements', { headers: { accept: 'application/json' } });
  // `wiring: null` = the report is unavailable: blocks with connections then fail closed (spec 150).
  if (!res.ok) return { elements: [], wiring: null };
  const body = (await res.json()) as { elements?: unknown[]; wiring?: WiringReport };
  return { elements: body.elements ?? [], wiring: body.wiring ?? null };
};
