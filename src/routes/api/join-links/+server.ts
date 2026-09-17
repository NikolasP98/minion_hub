import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireOrgCapability, JOINABLE_ROLE_KEY } from '$server/services/rbac.service';
import { createLink, listLinks } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, request, url }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  const user = locals.user!;
  const b = (await request.json().catch(() => ({}))) as {
    organizationId?: string;
    role?: string;
    expiresAt?: string | null;
    maxUses?: number | null;
  };
  // Real system role only — never 'owner' (JOINABLE_ROLE_KEY excludes it), and
  // never an arbitrary string (that used to collapse to 'manager' for everyone).
  const roleResult = JOINABLE_ROLE_KEY.safeParse(b.role);
  if (!roleResult.success) throw error(400, 'role must be one of: admin, manager, staff, viewer');
  const role = roleResult.data;

  // Org-scope the target: a non-platform-admin can only mint links for their
  // own active org (D4 — this used to accept any body.organizationId with no
  // check). Platform admins may target an explicit org.
  let organizationId = b.organizationId;
  if (user.role === 'admin') {
    organizationId = organizationId ?? locals.tenantCtx?.tenantId;
    if (!organizationId) throw error(400, 'organizationId required');
  } else {
    if (!locals.tenantCtx) throw error(401, 'tenant context required');
    if (organizationId && organizationId !== locals.tenantCtx.tenantId) {
      throw error(403, 'organizationId must match your active organization');
    }
    organizationId = locals.tenantCtx.tenantId;
  }

  const { id, token } = await createLink({
    organizationId,
    role,
    createdBy: user.id,
    expiresAt: b.expiresAt ?? null,
    maxUses: b.maxUses ?? null,
  });
  return json({ ok: true, id, url: `${url.origin}/join?token=${token}` });
};

export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  return json({ links: await listLinks(locals.tenantCtx.tenantId) });
};
