import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  deleteRole,
  updateRoleMeta,
  updateRolePermissions,
} from '$server/services/roles.service';
import { requireAdmin } from '$server/auth/authorize';
import { PERMISSIONS } from '$lib/permissions';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx || !params.id) throw error(400);
  const b = (await request.json()) as {
    name?: string;
    description?: string | null;
    permissions?: string[];
  };
  try {
    if (b.name !== undefined || b.description !== undefined) {
      await updateRoleMeta(locals.tenantCtx, params.id, {
        name: b.name,
        description: b.description,
      });
    }
    if (Array.isArray(b.permissions)) {
      const invalid = b.permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
      if (invalid.length) throw error(400, `invalid permissions: ${invalid.join(',')}`);
      await updateRolePermissions(locals.tenantCtx, params.id, b.permissions);
    }
    return json({ ok: true });
  } catch (e) {
    if (/system role/i.test(String(e))) throw error(403, 'cannot edit system role');
    throw error(500, String(e));
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx || !params.id) throw error(400);
  try {
    await deleteRole(locals.tenantCtx, params.id);
    return json({ ok: true });
  } catch (e) {
    if (/system/i.test(String(e))) throw error(403);
    throw error(500);
  }
};
