import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listRoles, createRole } from '$server/services/roles.service';
import { requireAdmin } from '$server/auth/authorize';
import { PERMISSIONS } from '$lib/permissions';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.tenantCtx) throw error(401);
  return json({ roles: await listRoles(locals.tenantCtx) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  const b = (await request.json()) as { name?: string; description?: string; permissions?: string[] };
  if (!b.name || !Array.isArray(b.permissions)) throw error(400);
  const invalid = b.permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  if (invalid.length) throw error(400, `invalid permissions: ${invalid.join(',')}`);
  try {
    const id = await createRole(locals.tenantCtx, {
      name: b.name,
      description: b.description,
      permissions: b.permissions,
    });
    return json({ ok: true, id });
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw error(409, 'role name taken');
    throw error(500, String(e));
  }
};
