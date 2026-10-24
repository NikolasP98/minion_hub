import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { readNavConfig } from '$server/services/nav-config.service';
import { loadPermissionsForUser } from '$server/services/permissions.service';
import { canonicalPath } from '$lib/canonical-path';
import {
  floorApplies,
  moduleViewFloor,
  pageViewKey,
  resolveNavInstance,
} from '$lib/nav/custom-sections';

const HEADERS = { 'cache-control': 'private, no-store' };
const notFound = () => json({ error: 'not_found' }, { status: 404, headers: HEADERS });

/** GET /api/nav/resolve?path=/staff/sell~k3x9q2/x — instance → target for a granted member. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const path = url.searchParams.get('path');
  if (!path || !path.startsWith('/') || path.startsWith('//')) return notFound();
  const hit = resolveNavInstance(await readNavConfig(ctx), canonicalPath(path));
  if (!hit) return notFound();
  const { permissions } = await loadPermissionsForUser(locals, user.id);
  const granted = new Set(permissions);
  if (!granted.has(`${pageViewKey(hit.page)}:view`)) return notFound();
  // Until spec 039 guards the module's reads, the instance must not widen module access.
  const floor = floorApplies(hit.target) ? moduleViewFloor(hit.target) : null;
  if (floor && !granted.has(floor))
    return json({ error: 'forbidden' }, { status: 403, headers: HEADERS });
  return json({ prefix: hit.prefix, target: hit.target, id: hit.page.id }, { headers: HEADERS });
};
