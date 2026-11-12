import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { deleteCustomRole, requireOrgCapability } from '$server/services/rbac.service';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { renameOrganizationRole } from '$server/services/organization-role-admin.service';

const renameSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'roles', 'edit');
  if (!locals.tenantCtx || !locals.user?.supabaseId) throw error(401);
  if (!params.key) throw error(400, 'role key required');
  const body = await parseBody(request, renameSchema);
  return json(await renameOrganizationRole(locals, params.key, body), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
};

/**
 * DELETE /api/roles/[key] — remove an org's custom role. Gated `roles:delete`.
 * `deleteCustomRole` 404s for a key this org never created (including system
 * role keys) and 409s while any member still holds it.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'roles', 'delete');
  if (!locals.tenantCtx) throw error(401);
  const key = params.key;
  if (!key) throw error(400, 'role key required');
  await deleteCustomRole(locals.tenantCtx.tenantId, key, locals);
  return json({ ok: true });
};
