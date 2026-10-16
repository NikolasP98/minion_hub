import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';

/** Admin-only POC surface (`route-access-registry`: `/sandbox` → `role:admin`). */
export const load: PageServerLoad = async ({ locals, fetch }) => {
  requireAdmin(locals);
  // TODO(handoff): swap for `listElements` from $server/sandbox/sandbox.service
  // once S1 lands — the service is owned by the data slice and does not exist yet.
  const res = await fetch('/api/sandbox/elements', { headers: { accept: 'application/json' } });
  if (!res.ok) return { elements: [] };
  const body = (await res.json()) as { elements?: unknown[] };
  return { elements: body.elements ?? [] };
};
