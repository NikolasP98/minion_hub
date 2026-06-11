import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { listAreas } from '$server/services/org-areas.service';
import { listUsers } from '$server/services/user.service';

/**
 * OVERVIEW graph data. Areas + org members are server-loaded here; the live
 * agent roster comes from the gateway WS client-side (`visibleAgents`) and is
 * stitched together in the page. `depends('app:org-areas')` lets the area
 * editor refresh just this slice after a mutation.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:org-areas');
  const ctx = requireTenantCtx(locals);

  const [areas, users] = await Promise.all([
    listAreas(ctx).catch(() => []),
    // Member list is admin-scoped in the UI, but the graph's outer ring needs
    // them; fall back to empty if the read fails (e.g. RLS / missing table).
    listUsers(ctx).catch(() => []),
  ]).catch(() => {
    throw error(500, 'Failed to load overview data');
  });

  return {
    areas,
    members: users.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
    })),
    isAdmin: locals.user?.role === 'admin',
  };
};
