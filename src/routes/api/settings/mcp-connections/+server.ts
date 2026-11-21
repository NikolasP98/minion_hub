import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listConnections } from '$server/mcp/oauth.service';
import { hasOrgCapability } from '$server/services/rbac.service';

/**
 * GET /api/settings/mcp-connections — the viewer's own live connections in the active
 * organization, or every one of them with `settings:manage` (spec 143 FR-011). Deliberately
 * not in `API_WRITE_PREFIXES`: ending your own connection needs no organization permission.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const all = await hasOrgCapability(locals, 'settings', 'manage');
  return json({ connections: await listConnections(ctx.tenantId, user.supabaseId!, all) });
};
