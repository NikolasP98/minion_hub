import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability, JOINABLE_ROLE_KEY } from '$server/services/rbac.service';
import { approveRequest } from '$server/services/join/requests.service';
import { loadOrganizationRolePolicy } from '$server/services/organization-role-policy';

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
  const policy = await loadOrganizationRolePolicy(body.organizationId);
  let role = body.role;
  if (policy.roleModel === 'legacy') {
    const roleResult = JOINABLE_ROLE_KEY.safeParse(role ?? 'staff');
    if (!roleResult.success) throw error(400, 'role must be one of: admin, manager, staff, viewer');
    role = roleResult.data;
  } else if (role !== undefined && (typeof role !== 'string' || !role.trim())) {
    throw error(400, 'role must be an organization role key');
  }

  await approveRequest(params.id!, {
    reviewerId: user.id,
    role,
    reviewerProfileId: user.supabaseId,
    organizationId: body.organizationId,
  });
  return json({ ok: true });
};
