import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { setDefaultOrganizationRole } from '$server/services/organization-role-admin.service';

const schema = z
  .object({
    roleKey: z.string().trim().min(1).max(256),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const PATCH: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'roles', 'edit');
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx || !locals.user?.supabaseId) throw error(401);
  const body = await parseBody(request, schema);
  return json(await setDefaultOrganizationRole(locals, body), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
};
