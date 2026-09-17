import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { revokeLink } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  const user = locals.user!;
  // Platform admins may revoke any org's link; everyone else is scoped to
  // their own active org — a non-matching id 404s instead of revoking.
  const organizationId = user.role === 'admin' ? undefined : locals.tenantCtx?.tenantId;
  if (user.role !== 'admin' && !organizationId) throw error(401, 'tenant context required');
  const revoked = await revokeLink(params.id!, organizationId);
  if (!revoked) throw error(404, 'link not found');
  return json({ ok: true });
};
