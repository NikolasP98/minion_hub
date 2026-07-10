import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getSchemaCatalog } from '$server/services/schema-catalog';

/**
 * GET /api/builder/tools/schema-catalog — DB table/column catalog for the
 * editor's SQL-completion + Queries tab (spec C10/C11/C13). Gated on
 * `tools.view` like the rest of /api/builder/tools*. Static per build — see
 * `$server/services/schema-catalog` for the table inventory + cache.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireOrgCapability(locals, 'tools', 'view');
	return json({ tables: getSchemaCatalog() });
};
