import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { denyRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  const user = locals.user!;
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  // Scope the deny to the caller's own org so it can't resolve another tenant's request.
  await denyRequest(params.id!, { reviewerId: user.id, organizationId: locals.tenantCtx.tenantId });
  return json({ ok: true });
};
