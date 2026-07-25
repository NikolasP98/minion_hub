import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireOrgCapability } from '$server/services/rbac.service';
import { probeArchitecture } from '$server/services/architecture.service';

/** Live infrastructure snapshot for the /reliability Architecture tab. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'reliability', 'view');
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!orgId) throw error(401, 'tenant context required');
  return json(await probeArchitecture(orgId));
};
