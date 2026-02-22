import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateUserRole, removeUserFromTenant, getUser } from '$server/services/user.service';

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
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
    throw error(400, 'role must be one of: owner, admin, member, viewer');
  }

  await updateUserRole(ctx, userId, b.role as Role);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  const existing = await getUser(ctx, userId);
  if (!existing) throw error(404, 'user not found');

  await removeUserFromTenant(ctx, userId);
  return json({ ok: true });
};
