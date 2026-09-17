import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { approveRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  const user = locals.user!;
  const body = (await request.json().catch(() => ({}))) as {
    role?: string;
    organizationId?: string;
  };
  if (!body.organizationId) throw error(400, 'organizationId required');
  // Non-platform-admins may only approve into their own active org — the
  // requester's chosen org and the reviewer's org must match (D4).
  if (user.role !== 'admin') {
    if (!locals.tenantCtx || body.organizationId !== locals.tenantCtx.tenantId) {
      throw error(403, 'organizationId must match your active organization');
    }
  }
  await approveRequest(params.id!, {
    reviewerId: user.id,
    role: body.role ?? 'user',
    organizationId: body.organizationId,
  });
  return json({ ok: true });
};
