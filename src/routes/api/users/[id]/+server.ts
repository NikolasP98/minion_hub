import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateUserRole, deleteUser, getUser } from '$server/services/user.service';
import { requireAdmin } from '$server/auth/authorize';

const VALID_ROLES = ['user', 'admin'] as const;
type Role = (typeof VALID_ROLES)[number];

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  const existing = await getUser(ctx, userId);
  if (!existing) throw error(404, 'user not found');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const b = body as Record<string, unknown>;
  if (!b.role || !VALID_ROLES.includes(b.role as Role)) {
    throw error(400, 'role must be one of: user, admin');
  }

  await updateUserRole(ctx, userId, b.role as Role);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  // Prevent self-deletion
  if (userId === locals.user?.id) throw error(400, 'cannot delete your own account');

  const existing = await getUser(ctx, userId);
  if (!existing) throw error(404, 'user not found');

  await deleteUser(ctx, userId);
  return json({ ok: true });
};
