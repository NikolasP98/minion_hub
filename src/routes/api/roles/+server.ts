import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { createCustomRole, requireOrgCapability } from '$server/services/rbac.service';

/**
 * POST /api/roles — duplicate an existing role (system or custom) into a new
 * org-scoped custom role, cloning its effective permission matrix. Gated
 * `users:manage`, same as the rest of the Role Permission Manager writes.
 */

const postSchema = z.object({
	sourceRoleKey: z.string().trim().min(1),
	name: z.string().trim().min(1).max(120),
});

export const POST: RequestHandler = async ({ locals, request }) => {
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401);
	if (!locals.user?.supabaseId) throw error(401, 'caller identity required');
	const body = await parseBody(request, postSchema);
	const role = await createCustomRole(locals.tenantCtx.tenantId, body, locals.user.supabaseId);
	return json(role, { status: 201 });
};
