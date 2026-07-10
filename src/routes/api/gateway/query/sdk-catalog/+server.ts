import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { getSchemaCatalog } from '$server/services/schema-catalog';
import { MODULE_VARS } from '$server/services/hub-module-vars';

/**
 * GET /api/gateway/query/sdk-catalog?agentId=personal-<uuid>[&orgId=]
 *
 * Agent-facing mirror of `/api/builder/tools/schema-catalog` (spec C11) — the
 * "flashlight" data the gateway's `sdk_inspect` tool (C15) proxies for its
 * `hub-modules` + `db-schema` sources. Superset of the session endpoint: same
 * `tables`, plus the `/api/gateway/query|actions/*` endpoint inventory (C9)
 * reused verbatim from `/api/builder/tools/variables` rather than duplicated.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAssistantCapability(locals, url, 'tools', 'view');
	return json({ tables: getSchemaCatalog(), modules: MODULE_VARS });
};
