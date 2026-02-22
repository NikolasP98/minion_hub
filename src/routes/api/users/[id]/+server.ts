import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { updateUserRole, removeUserFromTenant } from '$server/services/user.service';

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  const body = await request.json();
  if (!body.role || !VALID_ROLES.includes(body.role as Role)) {
    throw error(400, 'role must be one of: owner, admin, member, viewer');
  }

  await updateUserRole(ctx, userId, body.role as Role);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  await removeUserFromTenant(ctx, userId);
  return json({ ok: true });
};
