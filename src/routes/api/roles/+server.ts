import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { createOrganizationRole } from '$server/services/organization-role-admin.service';

/**
 * Create an independent organization role from a versioned template, an
 * existing role, or a blank matrix. Legacy duplication bodies remain supported.
 * All writes require roles:create and the service's fresh delegation checks.
 */

const name = z.string().trim().min(1).max(120);
const sourceRoleKey = z.string().trim().min(1).max(256);
const creation = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('template'),
      name,
      templateId: z.enum(['admin', 'manager', 'staff', 'viewer']),
      templateVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ source: z.literal('duplicate'), name, sourceRoleKey }).strict(),
  z.object({ source: z.literal('blank'), name }).strict(),
]);
// Preserve the legacy duplication request while routing all writes through the
// transactional, model-aware administrator service.
const postSchema = z.union([
  creation,
  z
    .object({ sourceRoleKey, name })
    .strict()
    .transform((body) => ({
      ...body,
      source: 'duplicate' as const,
    })),
]);

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'roles', 'create');
  if (!locals.tenantCtx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401, 'caller identity required');
  const body = await parseBody(request, postSchema);
  const role = await createOrganizationRole(locals, body);
  return json(role, { status: 201 });
};
